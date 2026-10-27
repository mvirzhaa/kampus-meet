#!/bin/sh
# Opsional: host sendiri model segmentasi untuk latar virtual (tanpa akses ke Google saat dipakai).
set -e
curl -fL -o public/vendor/mediapipe/selfie_segmenter.tflite \
  https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite
echo "Selesai. Set SEGMENTER_MODEL_URL=/vendor/mediapipe/selfie_segmenter.tflite di .env lalu restart aplikasi."
