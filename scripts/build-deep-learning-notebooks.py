"""Generate and optionally execute the course notebooks with nbformat/nbclient.

Run node scripts/build-deep-learning.mjs first. This is an authoring/QA step;
Netlify serves the committed notebooks and does not require Python or PyTorch.
"""
import argparse
import json
from pathlib import Path
import nbformat

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--execute", action="store_true")
args = parser.parse_args()
content = json.loads((ROOT / ".runtime/deep-learning/notebook-inputs.json").read_text())
destination = ROOT / "room310files/notebooks"
destination.mkdir(exist_ok=True)

for lesson in content["lessons"]:
    cells = [nbformat.v4.new_markdown_cell(
        f"# {lesson['title']}\n\nRoom310 · Deep learning foundations\n\n"
        f"## Goal\n\n{lesson['goal']}\n\n## Setup\n\n"
        "Run this notebook from top to bottom. It is self-contained and uses only synthetic teaching data. "
        "No credentials or dataset downloads are needed. Save a copy before editing.\n\n" +
        ("Use a CPU Python environment with PyTorch installed. In Colab, connect to the default CPU runtime. "
         "If `import torch` fails, run `%pip install torch` in a separate cell and restart the kernel if asked. "
         "For local installation, follow https://pytorch.org/get-started/locally/.\n\n"
         "Examples use a fixed seed where relevant; exact floating-point results can vary by environment.\n\n"
         if lesson["runtime"] == "pytorch" else "The first two lessons need only standard Python.\n\n") +
        "## Steps"
    )]
    for index, section in enumerate(lesson["sections"], 1):
        cells.append(nbformat.v4.new_markdown_cell(f"### {index}. {section['title']}\n\n{section['text']}"))
        if section.get("code"):
            cells.append(nbformat.v4.new_code_cell(section["code"]))
        if section.get("check"):
            cells.append(nbformat.v4.new_markdown_cell(f"**Check your result:** {section['check']}"))
    cells.append(nbformat.v4.new_markdown_cell("## Checks\n\n" + lesson["takeaway"] +
        "\n\nCompare your output with each check above. Explain unexpected results before moving on."))
    cells.append(nbformat.v4.new_markdown_cell("## Next Steps\n\n### Practice & explain"))
    for assignment in lesson["assignments"]:
        cells.append(nbformat.v4.new_markdown_cell(f"### {assignment['title']}\n\n{assignment['task']}\n\n"
            f"<details><summary>Need a hint?</summary>\n\n{assignment['hint']}\n\n</details>"))
        cells.append(nbformat.v4.new_code_cell("# Your experiment or explanation goes here.\n"))
    cells.append(nbformat.v4.new_markdown_cell("### References\n\n" + "\n".join(
        f"- [{content['sources'][key][0]}]({content['sources'][key][1]})" for key in lesson["references"])))
    notebook = nbformat.v4.new_notebook(cells=cells, metadata={
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python"},
        "room310": {"runtime": lesson["runtime"], "synthetic_data": True}
    })
    # Stable cell ids keep regenerations reviewable.
    for index, cell in enumerate(notebook.cells):
        cell.id = f"room310-{index:02d}"
    nbformat.validate(notebook)
    if args.execute:
        from nbclient import NotebookClient
        working = ROOT / ".runtime/deep-learning" / lesson["slug"]
        working.mkdir(exist_ok=True)
        NotebookClient(notebook, timeout=120, kernel_name="python3",
                       resources={"metadata": {"path": str(working)}}).execute()
        for cell in notebook.cells:
            # Timing metadata is not useful to learners and makes noisy diffs.
            cell.metadata.pop("execution", None)
        nbformat.validate(notebook)
    nbformat.write(notebook, destination / f"{lesson['slug']}.ipynb")
    print(f"{'Executed' if args.execute else 'Generated'} {lesson['slug']}", flush=True)
