# Evaluation methodology

The checked-in Northstar benchmark contains answerable, cross-document, identifier, and unanswerable questions. Its references are fictional corpus filenames. `/evaluations/dataset` maps those filenames to authorized current document IDs in the selected workspace and reports missing filenames. The UI can load those cases or build a custom benchmark. A selected question and expected documents must be added to the case list before running.

Evaluation jobs use the same retrieval function as chat. Parameters include K, hybrid/semantic/keyword mode, embedding identity, reranking flag, and branch candidate counts. Configuration and individual results persist alongside the run. Retrieved IDs are deduplicated to document level, preserving first occurrence order. This means K is a maximum document-slot denominator while the retriever returns at most K chunks; multiple chunks from one document can lower document-level precision. This deliberate definition is visible rather than silently changing the denominator.

- **Precision@K**: relevant unique document hits / K.
- **Recall@K**: relevant unique document hits / number of expected documents.
- **MRR**: reciprocal rank of the first relevant unique document, or zero.
- **Latency**: wall-clock milliseconds around retrieval, including query embedding calls where used.

Macro quality averages include only answerable cases. Unanswerable cases report whether retrieval was empty and expose candidates for manual review. Empty retrieval is not asserted to prove correct generation behavior. Mean latency includes every case. No fabricated baseline or quality score is inserted into the UI.

Chat generation validates citation IDs and requires references when generating from evidence. Routine tests check valid/invalid citations, context budgets, prompt boundary placement, provider output validation, streaming failure propagation, roles, and embeddings. These are technical checks, not a model-faithfulness benchmark. Generation answers, faithfulness/entailment judgments, reference-answer scoring, and model-assisted quality review are not currently included in evaluation runs.

Reproducibility has limits: provider model weights, document content, and index contents can change. The initial implementation records retrieval configuration but does not snapshot the entire corpus or provider model revision. Run comparisons should use the same corpus and model identity. A corpus manifest/hash snapshot and explicit side-by-side configuration comparison are remaining work. The UI displays each stored run and its cases but does not claim full experiment tracking.

Usage charts use only recorded AI requests and measured durations. Token totals remain unavailable when the provider does not report them. Structured generation currently does not capture provider token metadata. No cost estimate is shown; pricing and billable-cost accounting are intentionally absent.
