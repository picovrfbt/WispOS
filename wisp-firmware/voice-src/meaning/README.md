# The meaning-matcher

When Wisp's own rules (`wisp-daemon/daemon/voice_understand.go`) don't
recognise a request and no phone model is connected, the Car Thing compares
what was said with a bank of examples by meaning, and runs the matching
example's command: "I'm nodding off" → "play something energetic".

| File | What it is |
| --- | --- |
| `examples.tsv` | The examples: a way of saying something, a tab, the command it means. Add lines here. |
| `make_bank.py` | Turns the examples into `bank.bin` with the model (`python make_bank.py <model folder> .`). Needs onnxruntime, tokenizers and numpy. |
| `bank.bin` | Each example's meaning, worked out ahead of time (int8, 384 numbers each). |
| `tokens.tsv` | Sample tokenisations, so the daemon's Go tokenizer is tested against the model's own. |
| `vocab.txt` | The model's vocabulary. |
| `wisp_meaning_server.c` | Runs the model on the Car Thing: token ids in, a meaning vector out. |
| `onnxruntime_c_api.h`, `onnxruntime_ep_c_api.h` | ONNX Runtime 1.24.4's headers (MIT), the version the speech recogniser ships. |

The model is [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
(Apache-2.0), quantised to 23 MB ([Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2));
`os/scripts/prepare.sh` fetches it. After adding examples, rebuild `bank.bin` with
the same model file.

It costs no memory while unused: the daemon starts `wisp_meaning_server` on
the first miss and stops it, dropping the vocabulary and bank too, after a
quiet minute. A match must be close (0.6) and clearly ahead of any other
command (0.03), and a few word checks stop it mixing up opposites ("too loud"
is never "turn it up"). On 35 new phrasings it hadn't seen, it got 25 right,
passed on 9 and got 1 slightly wrong.
