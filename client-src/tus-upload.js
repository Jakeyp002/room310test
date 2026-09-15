const TUS_VERSION = "1.0.0";
const CHUNK_BYTES = 6 * 1024 * 1024;
const RETRY_DELAYS = [0, 1000, 3000, 5000, 10_000];

function savedUpload(key) {
  try { return globalThis.localStorage?.getItem(key) || ""; } catch { return ""; }
}

function rememberUpload(key, value) {
  try { globalThis.localStorage?.setItem(key, value); } catch { /* Resuming after reload is optional. */ }
}

function forgetUpload(key) {
  try { globalThis.localStorage?.removeItem(key); } catch { /* Nothing else to clean up. */ }
}

function wait(milliseconds, signal) {
  if (!milliseconds) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException("Upload aborted", "AbortError"));
    }, { once: true });
  });
}

function metadata(values) {
  return Object.entries(values)
    .map(([key, value]) => `${key} ${btoa(unescape(encodeURIComponent(String(value))))}`)
    .join(",");
}

function directStorageEndpoint(projectUrl) {
  const url = new URL(projectUrl);
  const projectRef = url.hostname.split(".")[0];
  if (!/^[a-z0-9]+$/.test(projectRef)) throw new Error("The Supabase project URL is not valid for resumable uploads.");
  return `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
}

async function checkedFetch(url, options, expected) {
  const response = await fetch(url, options);
  if (!expected.includes(response.status)) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(detail || `Upload failed with HTTP ${response.status}.`);
  }
  return response;
}

export async function uploadStandaloneTus({ projectUrl, publishableKey, accessToken, file, objectName, onProgress = () => {}, signal }) {
  if (!accessToken) throw new Error("Your administrator session expired. Sign in again before uploading.");
  const endpoint = directStorageEndpoint(projectUrl);
  const common = {
    authorization: `Bearer ${accessToken}`,
    apikey: publishableKey,
    "tus-resumable": TUS_VERSION
  };
  const fingerprint = `room310:tus:game-standalone:${objectName}:${file.size}`;
  let uploadUrl = savedUpload(fingerprint);
  let offset = 0;

  if (uploadUrl) {
    try {
      const response = await checkedFetch(uploadUrl, { method: "HEAD", headers: common, signal }, [200, 204]);
      offset = Number(response.headers.get("upload-offset") || 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size) throw new Error("Invalid saved upload offset.");
    } catch {
      uploadUrl = "";
      forgetUpload(fingerprint);
    }
  }

  if (!uploadUrl) {
    const response = await checkedFetch(endpoint, {
      method: "POST",
      headers: {
        ...common,
        "upload-length": String(file.size),
        "upload-metadata": metadata({ bucketName: "game-standalone", objectName, contentType: "text/html", cacheControl: "3600" }),
        "x-upsert": "true"
      },
      signal
    }, [201]);
    const location = response.headers.get("location");
    if (!location) throw new Error("The upload server did not return a resumable upload URL.");
    uploadUrl = new URL(location, endpoint).href;
    rememberUpload(fingerprint, uploadUrl);
  }

  while (offset < file.size) {
    const end = Math.min(offset + CHUNK_BYTES, file.size);
    let completed = false;
    let lastError;
    for (let attempt = 0; attempt < RETRY_DELAYS.length && !completed; attempt += 1) {
      await wait(RETRY_DELAYS[attempt], signal);
      try {
        const response = await checkedFetch(uploadUrl, {
          method: "PATCH",
          headers: { ...common, "content-type": "application/offset+octet-stream", "upload-offset": String(offset) },
          body: file.slice(offset, end),
          signal
        }, [204]);
        const nextOffset = Number(response.headers.get("upload-offset") || end);
        if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset || nextOffset > file.size) throw new Error("The upload server returned an invalid offset.");
        offset = nextOffset;
        completed = true;
      } catch (error) {
        lastError = error;
        if (signal?.aborted) throw error;
        try {
          const head = await checkedFetch(uploadUrl, { method: "HEAD", headers: common, signal }, [200, 204]);
          const resumedOffset = Number(head.headers.get("upload-offset") || 0);
          if (!Number.isSafeInteger(resumedOffset) || resumedOffset < offset || resumedOffset > file.size) throw error;
          if (resumedOffset > offset) {
            offset = resumedOffset;
            completed = true;
          }
        } catch {
          // Retry the same chunk. The saved upload URL remains reusable after a transient failure.
        }
      }
    }
    if (!completed) throw lastError || new Error("The standalone upload could not be resumed.");
    onProgress(offset, file.size);
  }

  forgetUpload(fingerprint);
  return { objectName, uploadUrl };
}
