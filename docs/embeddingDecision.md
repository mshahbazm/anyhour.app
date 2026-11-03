# Embedding and retrieval decision

Status: **initial default, to be revisited with larger and multilingual sites**.

- Embed cleaned page content with OpenAI `text-embedding-3-small` at **384 dimensions**. Embed visitor questions with the same model and dimensions.
- Remove navigation, site-wide headers and footers, and repeated boilerplate before indexing. Keep each source page and its URL/title in the database so it can be reviewed and refreshed.
- Split content into roughly **300-word chunks with 40-word overlap** as the starting point. Make production splitting aware of tokens and section boundaries; keep headings and qualifying terms with the facts they describe.
- Store one vector **per chunk**, never one vector for a whole website. Keep chunk text and source metadata alongside the vector. Search only the relevant chatbot's chunks and send the best passages, initially up to five, to the answering model.
- Keep exact identifiers, URLs, crawl state, and timestamps as ordinary database fields. They do not need embeddings. Re-embed only when indexed content, including the title or headings, has changed.
- Track the embedding model and dimension used for indexed content so changing either later requires an explicit reindex.

Evidence: On 22 cleaned pages and 60 answerable questions, `text-embedding-3-small` at 384 dimensions placed the supporting passage in the top five for all 60. With dimensions fixed at 384, 300-word chunks retrieved 60/60 in the top five and 44/60 at rank one. The 150-word variant retrieved 59/60 in the top five and split one claim from its local-terms caveat. The 600-word variant retrieved 60/60 in the top five but ranked fewer passages first and sent more text to the answering model. See the [benchmark report](https://github.com/mshahbazm/anyhour/blob/72c66e464f53e7f84bb8e8c8f2a760e565f387f7/experiments/embeddingBenchmark/REPORT.md) and [chunking results](https://github.com/mshahbazm/anyhour/blob/72c66e464f53e7f84bb8e8c8f2a760e565f387f7/experiments/embeddingBenchmark/results/chunkingSummary.json).

Cost is not the reason to self-host embeddings initially. At the [current OpenAI rate](https://developers.openai.com/api/docs/models/text-embedding-3-small) of $0.02 per million input tokens, a free allowance of 25,000 cleaned characters is roughly $0.00012–$0.00016 to index once. Answer generation and conversation history are much larger variable costs.

This decision does not settle full-site discovery, automatic refresh cadence, or the final database schema. The benchmark used a small English corpus with known answer pages; retest on larger and multilingual sites before treating the chunk size or model as permanent.
