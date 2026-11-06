# AI Guitar Coach

A browser app that listens to a guitarist play single notes and says, within
200 ms, whether the note was right, and, with the webcam, whether it was played
on the right string and fret. Software Capstone Design 1.

| Folder | What it is |
| --- | --- |
| [`web/`](web/) | The product: a TypeScript + Vite app, based on [Guitar-Learning](https://github.com/DecoudJuan/Guitar-Learning) by DecoudJuan (MIT). Start with [web/README.md](web/README.md). |
| [`lab/`](lab/) | The offline audio lab, in Python: records a labelled test set, measures the note detector, and tunes the parameters the web app copies. Formerly [AI-Guitar-Tuto-Integration-Public](https://github.com/mortem1504/AI-Guitar-Tuto-Integration-Public). |

Both histories were kept when the two repositories were joined: `git log --
web/` and `git log -- lab/` show each project's commits from the beginning.

```bash
cd web && npm install && npm run dev     # http://localhost:3004
cd lab && python -m venv .venv && .venv/bin/pip install -r requirements.txt
```

Everything runs in the browser. Audio and video are never uploaded.
