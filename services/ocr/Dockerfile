FROM python:3.11-slim

# OpenCV runtime libraries used by PaddleOCR.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN pip install --no-cache-dir -i ${PIP_INDEX_URL} -r requirements.txt

COPY app.py .

# Models are downloaded on first start into /root/.paddlex (mount a volume).
# Model source: bos (Baidu, fast in mainland China), huggingface, modelscope, aistudio.
ENV PADDLE_PDX_MODEL_SOURCE=bos \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True \
    OCR_LANG=ch \
    OCR_DEVICE=cpu

EXPOSE 8866
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8866"]
