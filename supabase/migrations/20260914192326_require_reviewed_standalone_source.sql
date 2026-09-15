alter table public.games
  drop constraint games_source_fields_check,
  drop constraint games_publishable_source_check;

alter table public.games
  add constraint games_source_fields_check check (
    (
      host_type = 'external'
      and external_url is not null
      and char_length(external_url) <= 2048
      and external_url ~* '^https?://[^[:space:]]+$'
      and external_url !~* '^https?://[^/]*@'
      and embed_html is null
      and bundle_path is null
      and standalone_html_path is null
      and source_sha256 is null
      and source_bytes is null
      and standalone_reviewed_sha256 is null
    )
    or
    (
      host_type = 'embed'
      and external_url is null
      and bundle_path is null
      and embed_html is not null
      and char_length(embed_html) between 1 and 500000
      and embed_html ~ '[^[:space:]]'
      and octet_length(embed_html) <= 524288
      and standalone_html_path is null
      and source_sha256 is null
      and source_bytes is null
      and standalone_reviewed_sha256 is null
    )
    or
    (
      host_type = 'hosted'
      and external_url is null
      and embed_html is null
      and standalone_html_path is null
      and source_sha256 is null
      and source_bytes is null
      and standalone_reviewed_sha256 is null
    )
    or
    (
      host_type = 'standalone'
      and external_url is null
      and embed_html is null
      and bundle_path is null
      and (
        (
          standalone_html_path is null
          and source_sha256 is null
          and source_bytes is null
          and standalone_reviewed_sha256 is null
        )
        or
        (
          standalone_html_path is not null
          and standalone_html_path ~ '^[0-9]+/standalone-[a-f0-9]{64}[.]html$'
          and source_sha256 is not null
          and source_sha256 ~ '^[a-f0-9]{64}$'
          and source_bytes is not null
          and source_bytes between 1 and 31457280
          and (
            standalone_reviewed_sha256 is null
            or standalone_reviewed_sha256 ~ '^[a-f0-9]{64}$'
          )
        )
      )
    )
  ),
  add constraint games_publishable_source_check check (
    status = 'draft'
    or host_type in ('external', 'embed')
    or (host_type = 'hosted' and bundle_path is not null)
    or (
      host_type = 'standalone'
      and standalone_html_path is not null
      and source_sha256 is not null
      and standalone_reviewed_sha256 is not null
      and standalone_reviewed_sha256 = source_sha256
    )
  );
