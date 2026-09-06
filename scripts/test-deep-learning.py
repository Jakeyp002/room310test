"""Numerical regression checks for the exact downloadable teaching scripts."""
import contextlib
import io
import os
from pathlib import Path
import runpy
import tempfile
import torch

ROOT = Path(__file__).resolve().parents[1]
torch.set_num_threads(1)
scripts = sorted((ROOT / "room310files/downloads").glob("deep-learning-*.py"))
assert len(scripts) == 6
with tempfile.TemporaryDirectory(prefix="room310-neural-check-") as working:
    previous = Path.cwd()
    try:
        os.chdir(working)
        for index, script in enumerate(scripts, 1):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                state = runpy.run_path(str(script))
            if index == 1:
                assert state["prediction"] == 7.0 and state["activated"] == 0.25
            elif index == 2:
                assert abs(state["weight"] - 2) < 0.001
                assert abs(state["bias"] - 1) < 0.001
                assert abs(state["slope"] + 36) < 0.001
            elif index == 3:
                assert torch.allclose(state["predictions"], torch.tensor([[2.75], [5.75], [8.75]]))
            elif index == 4:
                assert abs(state["weight"].item() - 2) < 0.001
                assert abs(state["bias"].item() - 1) < 0.001
            elif index == 5:
                assert state["accuracy"] == 1.0, output.getvalue()
                assert sum(p.numel() for p in state["model"].parameters()) == 33
            elif index == 6:
                groups = [set(state[key].tolist()) for key in ["train_ids", "val_ids", "test_ids"]]
                assert [len(g) for g in groups] == [240, 80, 80]
                assert not (groups[0] & groups[1] or groups[0] & groups[2] or groups[1] & groups[2])
                assert len(set.union(*groups)) == 400
                assert state["test_accuracy"] >= 0.85, output.getvalue()
                assert len(state["history"]) == 4
                assert Path("room310_tiny_net.pt").is_file()
            print(f"PASS {script.name}\n{output.getvalue()}", flush=True)
    finally:
        os.chdir(previous)
