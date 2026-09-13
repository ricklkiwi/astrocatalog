# Triage Labels

> Configures the Matt Pocock engineering skills (`triage`, etc). Unrelated to the `*.agent.md` pipeline prompts elsewhere in this directory.

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Role in mattpocock/skills | Label in this repo | Meaning                                  |
| ------------------------- | ------------------ | ---------------------------------------- |
| `needs-triage`            | `needs-triage`     | Maintainer needs to evaluate this issue  |
| `needs-info`              | `needs-info`       | Waiting on reporter for more information |
| `ready-for-agent`         | `ready-for-agent`  | Fully specified, ready for an AFK agent  |
| `ready-for-human`         | `ready-for-human`  | Requires human implementation            |
| `wontfix`                 | `wontfix`          | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Setup status

`wontfix` already exists as a default GitHub label. The other four don't exist yet on `ricklkiwi/astrocatalog` — create them before the `triage` skill relies on them:

```bash
gh label create needs-triage    --color EDEDED --description "Maintainer needs to evaluate this issue"
gh label create needs-info      --color EDEDED --description "Waiting on reporter for more information"
gh label create ready-for-agent --color EDEDED --description "Fully specified, ready for an AFK agent"
gh label create ready-for-human --color EDEDED --description "Requires human implementation"
```

Edit the right-hand column above (and re-run the relevant `gh label create`/`gh label edit` command) if you ever want different label strings.
