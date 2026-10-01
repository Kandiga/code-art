#!/usr/bin/env bash
# audio/vo/setup.sh - one-time offline-TTS setup (python venv + Piper voices + Whisper for QA).
# Idempotent. PyPI + huggingface.co only (GitHub release downloads are not needed).
#   python : audio/vo/.venv/bin/python
#   models : audio/vo/models/<voice>.onnx(.json)   (HF_HOME for Whisper = audio/vo/models/hf)
set -euo pipefail
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet piper-tts numpy scipy soundfile onnx praat-parselmouth faster-whisper speechmos
mkdir -p models
VOICES="${VOICES:-en_US-ryan-high en_GB-cori-high en_GB-alan-medium en_US-lessac-high en_US-kristin-medium en_GB-northern_english_male-medium en_GB-jenny_dioco-medium en_US-hfc_female-medium en_GB-alba-medium en_US-libritts-high en_US-hfc_male-medium en_US-john-medium en_US-norman-medium en_US-joe-medium en_US-sam-medium en_US-mike-medium en_US-bryce-medium en_US-lessac-medium}"
for n in $VOICES; do
  loc=${n%%-*}; rest=${n#*-}; name=${rest%-*}; q=${rest##*-}; lang=${loc%%_*}
  base=https://huggingface.co/rhasspy/piper-voices/resolve/main/$lang/$loc/$name/$q/$n
  for ext in onnx.json onnx; do
    [ -s "models/$n.$ext" ] || curl -sL --retry 3 -o "models/$n.$ext.part" "$base.$ext" && mv -f "models/$n.$ext.part" "models/$n.$ext" 2>/dev/null || true
  done
done
# Whisper (QA only): downloads base.en / small.en on first use into models/hf
echo "ok: $(ls models/*.onnx | wc -l) voices; python = $(pwd)/.venv/bin/python"
