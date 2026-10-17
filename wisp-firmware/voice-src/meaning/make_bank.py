"""
Builds the Car Thing's meaning bank: each example in examples.tsv, turned
into the model's meaning (all-MiniLM-L6-v2, the same quantised ONNX model the
Car Thing runs), stored with the command it stands for.

    python make_bank.py <model folder> <out folder>

The model folder holds model_quantized.onnx and tokenizer.json (from
Xenova/all-MiniLM-L6-v2 on Hugging Face). Writes:

  bank.bin        "WMB1", count, dim, then per example: the command (u16
                  length + UTF-8) and the meaning as dim int8 values (x127)
  tokens.tsv      sample texts and their token ids, for the Go tokenizer's test

Needs onnxruntime, tokenizers and numpy.
"""

import os
import struct
import sys

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

MAX_TOKENS = 32
HERE = os.path.dirname(os.path.abspath(__file__))


def load_examples():
    out = []
    with open(os.path.join(HERE, "examples.tsv"), encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line.strip() or line.startswith("#"):
                continue
            said, command = line.split("\t")
            out.append((said.strip(), command.strip()))
    return out


def embed(session, tok, texts):
    out = []
    for t in texts:
        enc = tok.encode(t)
        ids = enc.ids[:MAX_TOKENS]
        ids_a = np.array([ids], dtype=np.int64)
        mask = np.ones_like(ids_a)
        feeds = {"input_ids": ids_a, "attention_mask": mask}
        if any(i.name == "token_type_ids" for i in session.get_inputs()):
            feeds["token_type_ids"] = np.zeros_like(ids_a)
        hidden = session.run(None, feeds)[0][0]  # [seq, dim]
        v = hidden.mean(axis=0)
        out.append(v / np.linalg.norm(v))
    return np.stack(out)


def main(model_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    tok = Tokenizer.from_file(os.path.join(model_dir, "tokenizer.json"))
    tok.no_padding()
    tok.no_truncation()
    session = ort.InferenceSession(os.path.join(model_dir, "model_quantized.onnx"))
    examples = load_examples()
    vecs = embed(session, tok, [e[0] for e in examples])
    with open(os.path.join(out_dir, "bank.bin"), "wb") as f:
        f.write(b"WMB1" + struct.pack("<II", len(examples), vecs.shape[1]))
        for (said, command), v in zip(examples, vecs):
            b = command.encode("utf-8")
            f.write(struct.pack("<H", len(b)) + b)
            f.write(np.clip(np.round(v * 127), -127, 127).astype(np.int8).tobytes())
    samples = [e[0] for e in examples[:20]] + [
        "Play Midnight City by M83", "what's the weather, today?", "I'm feeling sleepy... wake me up!",
        "Beyoncé's new album", "rock'n'roll", "unbelievable", "turn it up 2 notches",
    ]
    with open(os.path.join(out_dir, "tokens.tsv"), "w", encoding="utf-8") as f:
        for s in samples:
            f.write(s + "\t" + " ".join(map(str, tok.encode(s).ids[:MAX_TOKENS])) + "\n")
    # how well the bank tells its own commands apart: each example against the
    # others, leaving itself out
    sims = vecs @ vecs.T
    np.fill_diagonal(sims, -1)
    right = sum(examples[j][1] == examples[i][1] for i, j in enumerate(sims.argmax(axis=1)))
    print(f"{len(examples)} examples, {len(set(c for _, c in examples))} commands, dim {vecs.shape[1]}; "
          f"leave-one-out {right}/{len(examples)} land on the right command")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
