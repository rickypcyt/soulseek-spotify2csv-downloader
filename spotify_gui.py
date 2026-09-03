import csv
import os
import subprocess
import tkinter as tk
from tkinter import messagebox, ttk


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RUN_PS1 = os.path.join(SCRIPT_DIR, "run.ps1")
CSV_OUTPUT = os.path.join(SCRIPT_DIR, "gui_output.csv")


def run_spotify_to_csv(url):
    """Ejecuta run.ps1 para descargar la playlist a un CSV temporal."""
    cmd = [
        "powershell",
        "-ExecutionPolicy", "Bypass",
        "-File", RUN_PS1,
        "-Url", url,
        "-Output", CSV_OUTPUT,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr or result.stdout or "Error desconocido")
    return CSV_OUTPUT


def load_csv_into_tree(tree, filename):
    """Carga el CSV en el Treeview."""
    for item in tree.get_children():
        tree.delete(item)

    with open(filename, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    for idx, row in enumerate(rows, start=1):
        tree.insert(
            "",
            "end",
            iid=str(idx),
            values=(
                row.get("track_name", ""),
                row.get("artists", ""),
                row.get("album", ""),
                row.get("search_query", ""),
            ),
        )

    return len(rows)


def on_preview():
    url = url_entry.get().strip()
    if not url:
        messagebox.showerror("Falta link", "Pegá un link de Spotify.")
        return

    status_label.config(text="Descargando...")
    root.update()

    try:
        csv_file = run_spotify_to_csv(url)
        count = load_csv_into_tree(tree, csv_file)
        status_label.config(text=f"Listo: {count} pista(s).")
    except Exception as e:
        status_label.config(text="Error al descargar.")
        messagebox.showerror("Error", str(e))


def on_search_soulseek():
    selected = tree.selection()
    if not selected:
        messagebox.showwarning("Nada seleccionado", "Seleccioná una pista de la lista.")
        return

    item = tree.item(selected[0])
    search_query = item["values"][3]

    root.clipboard_clear()
    root.clipboard_append(search_query)

    messagebox.showinfo(
        "Buscar en Soulseek",
        f"Copiado al portapapeles:\n\n{search_query}\n\nPegalo en el buscador de SoulseekQt.",
    )


root = tk.Tk()
root.title("Spotify a Soulseek")
root.geometry("900x500")

frame_top = tk.Frame(root, padx=10, pady=10)
frame_top.pack(fill="x")

tk.Label(frame_top, text="Link de Spotify:").pack(side="left")
url_entry = tk.Entry(frame_top)
url_entry.pack(side="left", fill="x", expand=True, padx=(5, 5))

preview_btn = tk.Button(frame_top, text="Preview", command=on_preview)
preview_btn.pack(side="left", padx=(0, 5))

search_btn = tk.Button(frame_top, text="Buscar en Soulseek", command=on_search_soulseek)
search_btn.pack(side="left")

columns = ("track_name", "artists", "album", "search_query")
tree = ttk.Treeview(root, columns=columns, show="headings")
tree.heading("track_name", text="Pista")
tree.heading("artists", text="Artista(s)")
tree.heading("album", text="Album")
tree.heading("search_query", text="Busqueda Soulseek")

tree.column("track_name", width=250)
tree.column("artists", width=200)
tree.column("album", width=200)
tree.column("search_query", width=200)

tree.pack(fill="both", expand=True, padx=10, pady=(0, 10))

status_label = tk.Label(root, text="Esperando link...", anchor="w")
status_label.pack(fill="x", padx=10, pady=(0, 10))

root.mainloop()
