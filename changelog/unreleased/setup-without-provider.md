---
tipo: feat
titulo: Setup completes without a model-provider key; reads use stored values
---

### Changed
- Fresh installations complete onboarding and enable the knowledge base with no model-provider account, key, or model configuration.
- Setup status now reflects onboarding readiness; provider-key presence is reported separately.
- Transcript briefs return already-stored summaries and tags; missing values no longer trigger inference.
