#!/usr/bin/env bash
# Download the public DANA V General Arrangement PDF (not committed: it carries a confidentiality notice).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/input
curl -fSL -o data/input/dana_general_arrangement.pdf \
  "https://dana.dtu.dk/-/media/subsites/dana/23007-01-101-0110-01-r2-14-general-arrangement.pdf"
echo "764dfabfedfb37e6bf6bc3623a3e8434ad624d3d3601d2f982bb914f9d489c9d  data/input/dana_general_arrangement.pdf" | shasum -a 256 -c -
