---
tipo: fix
titulo: More reliable TikTok and web imports
---

TikTok imports use an updated extractor to restore downloads affected by recent
changes to public video pages.

Temporary connection failures, web timeouts and source request limits now receive
bounded automatic retries. Imports with long cooldowns return to the queue so
other content can continue processing. If the source remains unavailable, Voxen
explains that automatic attempts ended and offers retry or manual upload.

Source access restrictions and safety checks remain enforced.
