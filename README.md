# Mapolis (pre-beta6)

An interactive, COPPA/FERPA-compliant geography quiz game for students and educators.

## Branch & Deployment Status
- **Active Branch**: `pre-beta6`
- **Consumer Game**: `play/index.html` + shared root assets (published to `play.mapolis.app`)
- **Admin/Educator Portal**: `play/admin/` (published to `mapolis-admin.netlify.app`)

## Operational Artifacts & Guides
Key architectural and operational references are archived in the **Google AI Studio Artifacts** tab:
- **AI Brain (`ai_brain.md`)**: Full project history, task log (Tasks 1–75), and architectural rules.
- **Data Flows (`mapolis_data_flows.md`)**: Visual guides for anonymous authentication, client-side zero-knowledge SHA-256 password hashing, and RLS/RPC security models.
- **Zero-Credit Netlify Preview Skill (`netlify_preview_skill.md`)**: Strict guidelines for draft preview generation (`--no-build`, omitting `--prod`).







