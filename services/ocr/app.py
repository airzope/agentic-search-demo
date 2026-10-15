"""PaddleOCR HTTP service for CJK Search Studio.

POST /ocr   multipart form: file=<image or PDF>, lang=<optional, e.g. ch/japan/korean>
            -> {"pages": [{"page": 1, "text": "...", "lines": [{"text", "score", "box"}]}]}
GET  /health
"""

import os
import shutil
import tempfile
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

DEFAULT_LANG = os.environ.get("OCR_LANG", "ch")
DEVICE = os.environ.get("OCR_DEVICE", "cpu")
MIN_SCORE = float(os.environ.get("OCR_MIN_SCORE", "0.5"))
ALLOWED = {".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff", ".pdf"}

_engines = {}
_lock = threading.Lock()  # PaddleOCR pipelines are not thread-safe


def _engine(lang):
    if lang not in _engines:
        from paddleocr import PaddleOCR

        _engines[lang] = PaddleOCR(
            lang=lang,
            device=DEVICE,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=True,
        )
    return _engines[lang]


def _tolist(value):
    return value.tolist() if hasattr(value, "tolist") else value


def _page(result, fallback_page):
    data = result.get("res", result) if hasattr(result, "get") else result
    texts = list(data.get("rec_texts") or [])
    scores = [float(score) for score in (_tolist(data.get("rec_scores")) or [])]
    boxes = _tolist(data.get("rec_boxes"))
    if boxes is None or len(boxes) != len(texts):
        boxes = [None] * len(texts)
    lines = [
        {"text": text, "score": score, "box": box}
        for text, score, box in zip(texts, scores, boxes)
        if text.strip() and score >= MIN_SCORE
    ]
    page_index = data.get("page_index")
    return {
        "page": page_index + 1 if isinstance(page_index, int) else fallback_page,
        "text": "\n".join(line["text"] for line in lines),
        "lines": lines,
    }


@asynccontextmanager
async def lifespan(_app):
    # Load (and on first start, download) the default models before serving.
    if os.environ.get("OCR_PRELOAD", "1") == "1":
        with _lock:
            _engine(DEFAULT_LANG)
    yield


app = FastAPI(title="PaddleOCR service", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "lang": DEFAULT_LANG, "device": DEVICE, "loaded": sorted(_engines)}


@app.post("/ocr")
def ocr(file: UploadFile = File(...), lang: str = Form(None)):
    suffix = os.path.splitext(file.filename or "")[1].lower()
    if suffix not in ALLOWED:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {suffix or '?'}")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        shutil.copyfileobj(file.file, tmp)
        path = tmp.name
    try:
        with _lock:
            results = _engine(lang or DEFAULT_LANG).predict(path)
        return {"pages": [_page(result, index + 1) for index, result in enumerate(results)]}
    except HTTPException:
        raise
    except Exception as error:  # surface PaddleOCR errors to the caller
        raise HTTPException(status_code=500, detail=str(error)) from error
    finally:
        os.unlink(path)
