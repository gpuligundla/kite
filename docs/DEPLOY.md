# Deploy Kite's Azure resources

This guide creates every Azure resource Kite uses and writes their endpoints and keys into `brain/.env`. All of it, Claude included, bills to one Azure subscription. ElevenLabs is the only service outside Azure, and OpenRouter is an optional second one.

`infra/deploy.sh` creates these resources in one resource group:

- A Microsoft Foundry account with four model deployments: `claude-sonnet-5-5`, `claude-haiku-5-5`, `decision-1` (the Microsoft-Decision-1 model) and `text-embedding-3-small`. The same account serves Content Safety and Prompt Shields.
- A Foundry project for the hosted studio agent.
- A container registry for the brain, web and studio agent images.
- A Log Analytics workspace and Application Insights.
- On Sunday only, a Container Apps environment with the `kite-brain` and `kite-web` apps.

## Before you start

You need the following:

- Azure CLI 2.80 or later. Check with `az version`. Run `az bicep install` once.
- Python 3 and `uv`, which the brain already uses.
- A paid Azure subscription with a pay-as-you-go billing method, in a country where Anthropic sells Claude. Claude doesn't deploy on free trial, student, credit-only sponsored, or Cloud Solution Provider subscriptions.
- The **Owner** role on the subscription. Contributor can create the resources but can't create the role assignments the template makes.
- Enough Claude quota. A pay-as-you-go subscription gets 40 requests and 40,000 input tokens per minute for each Claude model by default. The night shift can hit that limit. To raise it, submit the [quota increase form](https://aka.ms/oai/stuquotarequest). Enterprise Agreement and MCA-E subscriptions start at 10,000 requests per minute.

Deploying accepts Anthropic's Azure Marketplace terms for you. Each Claude deployment sends your organization name, country code and industry in a `modelProviderData` block, and Azure signs the Marketplace offer with those values. Read these terms before you deploy:

- [Anthropic Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms)
- [Anthropic Usage Policy](https://www.anthropic.com/legal/aup)
- [Anthropic Supported Regions Policy](https://aka.ms/supported_anthropic_regions)

To accept the terms by hand instead, deploy one Claude model in the [Foundry portal](https://ai.azure.com) and select **Agree and Proceed**.

## Create the resources

1. Sign in.

	```bash
	az login
	```

2. Select the subscription that bills Kite.

	```bash
	az account set --subscription <subscription-id>
	```

3. Set the legal name of the organization that uses Claude. Anthropic receives this name.

	```bash
	export CLAUDE_ORG_NAME="<organization legal name>"
	```

4. If the defaults don't fit, export any of these variables:

	- `KITE_RG`, the resource group. The default is `rg-kite`.
	- `KITE_LOCATION`, the region. The default is `eastus2`.
	- `KITE_PREFIX`, lowercase letters and digits that start every resource name. The default is `kite`.
	- `CLAUDE_COUNTRY_CODE`, two letters. The default is `US`.
	- `CLAUDE_INDUSTRY`, one of `technology`, `finance`, `healthcare`, `education`, `retail`, `manufacturing`, `government`, `media` or `other`. The default is `education`.

5. Run the deploy script from the repository root.

	```bash
	infra/deploy.sh
	```

	The script registers the resource providers, creates the resource group and deploys `infra/main.bicep`. Model deployments run one at a time and can take several minutes each. When it finishes, the script prints the Foundry account, the project endpoint and the registry.

The script is safe to rerun. To preview what a rerun would change, run this command:

```bash
az deployment group what-if --resource-group rg-kite --parameters infra/main.bicepparam
```

### Pick another region

`eastus2` is the default because it serves all five services Kite needs: Claude Sonnet 5.5 and Haiku 5.5, Microsoft-Decision-1, `text-embedding-3-small`, Content Safety with Prompt Shields, and Foundry hosted agents. On 2026-10-24 these regions also served all five: `eastus`, `centralus`, `northcentralus`, `southcentralus`, `westus`, `westus3` and `swedencentral`. `westus2` has no Claude 5.5, so the template doesn't allow it.

### Change a model setting

The template pins Claude to version `1` on `GlobalStandard`. Version `1` runs on Anthropic's infrastructure. Version `2` runs on Azure, and for both 5.5 models it exists only as `DataZoneStandard` in US regions.

Microsoft-Decision-1 is in preview and is offered only as `DataZoneStandard`, so the template deploys it on that SKU. If you ask for `GlobalStandard`, preflight fails with `SpecialFeatureOrQuotaIdRequired`. Its deployment is named `decision-1` because Azure rejects resource names that contain "Microsoft".

To see which models and versions a region offers, run this command:

```bash
az cognitiveservices model list --location eastus2 \
	--query "[?model.format=='Anthropic' || model.name=='Microsoft-Decision-1' || model.name=='text-embedding-3-small'].{name:model.name, version:model.version, skus:join(',', model.skus[].name)}" -o table
```

To change a setting, add a line to `infra/main.bicepparam` and rerun `infra/deploy.sh`. For example, these lines move both Claude models to Azure hosting:

```bicep
param claudeVersion = '2'
param claudeSku = 'DataZoneStandard'
```

The other settings are `sonnetCapacity`, `haikuCapacity`, `decisionCapacity` and `embedCapacity`. For Claude and embeddings, capacity is in thousands of tokens per minute. Claude starts at 40, the pay-as-you-go cap. With more quota, set `KITE_SONNET_CAPACITY` and `KITE_HAIKU_CAPACITY`; a rerun of `deploy.sh` keeps whatever capacity is live unless you set them. This project runs both at 200, which also allows 200 requests a minute. Microsoft doesn't document what one unit of Decision-1 capacity buys. The catalog lists limits of 1 request and 1,000 tokens per minute, which appear to be per unit, and suggests a default capacity of 500, so the template deploys 500. If `scripts/probe_decision.py` returns HTTP 429, raise `decisionCapacity`. To find the largest value your subscription allows, read the limit for `AIServices.DataZoneStandard.Microsoft-Decision-1` in the output of this command:

```bash
az cognitiveservices usage list --location eastus2 --query "[?contains(name.value, 'Decision')]" -o table
```

## Write brain/.env

`KITE_MASTER_KEY` encrypts every family key in the database. If you replace it after the night shift, the brain can't open the snapshot. The script below creates the key only when `brain/.env` has none.

1. Run the script that writes the endpoints and keys.

	```bash
	infra/write-env.sh
	```

	The script sets `FOUNDRY_ENDPOINT`, `FOUNDRY_KEY`, `ANSWER_DEPLOYMENT`, `FAST_DEPLOYMENT`, `DECISION_DEPLOYMENT`, `EMBED_DEPLOYMENT`, `CONTENT_SAFETY_ENDPOINT` and `CONTENT_SAFETY_KEY`. It keeps every other line, sets the file mode to 600 and prints names, never values. It stops if git doesn't ignore `brain/.env`.

2. Read the last line it prints. That line lists the values you still have to fill in by hand.

If you used a different resource group, export the same `KITE_RG` before you run the script.

## Add the ElevenLabs key and voices

1. In [ElevenLabs](https://elevenlabs.io), create an API key with access to text to speech, speech to text and voices.
2. Set `ELEVENLABS_API_KEY` in `brain/.env` to that key.
3. Open the ElevenLabs **Voice Library** and pick nine adult voices. Kite never uses a child's voice.
	- Pick four band voices, one each for `K-2`, `3-5`, `6-8` and `9-12`. The brain slows down and adds expression for younger bands on its own.
	- Pick five character voices. `narrator` is a calm storyteller, `professor` a wise and slightly funny teacher, `explorer` a bold and excited adventurer, `storyteller` a warm and dramatic fairy-tale voice, and `robot_buddy` a cheerful, bouncy helper robot.
4. Add each voice to **My Voices** and copy its voice ID.
5. Set `KITE_VOICES` in `brain/.env` on one line, with every key filled in. If any key is missing, the brain fails the first time it speaks.

	```
	KITE_VOICES={"bands":{"K-2":"<id>","3-5":"<id>","6-8":"<id>","9-12":"<id>"},"characters":{"narrator":"<id>","professor":"<id>","explorer":"<id>","storyteller":"<id>","robot_buddy":"<id>"}}
	```

6. If you want a second route to Decision-1, set `OPENROUTER_KEY` to an [OpenRouter](https://openrouter.ai) key. When the Foundry deployment fails, the brain then tries OpenRouter before it falls back to Claude Haiku. OpenRouter bills outside Azure.

## Check that it works

Run these commands from `brain/`.

1. Ask Decision-1 two questions.

	```bash
	uv run python scripts/probe_decision.py
	```

	The Foundry section prints `HTTP 200` and a probability for every answer, with `alert_stranger` on top.

2. Seed the demo family and build the catalog vectors. The command prints one token for each device.

	```bash
	uv run python -m kite_brain.seed --assets
	```

	The last line reads `concept vectors: (<concepts>, 1536)`.

3. Start the brain.

	```bash
	uv run uvicorn kite_brain.api:app --no-access-log
	```

4. In a second terminal, export the `parent` and `os` tokens from step 2 as `PARENT` and `OS`, then follow the parent's event stream.

	```bash
	curl -N -H "Authorization: Bearer $PARENT" localhost:8000/kids/maya/events
	```

5. In a third terminal, send a turn.

	```bash
	curl -F kid_id=maya -F device=os -F mode=talk -F text="why is the sky blue?" \
		-H "Authorization: Bearer $OS" localhost:8000/turns
	```

	The event stream shows `decided`, `routed` and `answer.sentence` events, then `answer.done`.

6. Stop the brain, then run the night shift from the repository root. It rebuilds the database from scratch.

	```bash
	scripts/night-shift.sh
	```

	If the night shift runs short on time or quota, run `TURNS_PER_GRADE=15 scripts/night-shift.sh` instead.

## Use Claude Code with your Azure sign-in

The template gives your `az login` identity the **Azure AI User** role on the Foundry account, so Claude Code can call Claude without an API key. A new role assignment can take a few minutes to apply.

```bash
export CLAUDE_CODE_USE_FOUNDRY=1
export ANTHROPIC_FOUNDRY_RESOURCE=<foundryAccountName>
export ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-5-5
export ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-5-5
claude
```

## Deploy the studio agent

`scripts/deploy-studio-agent.sh` builds the `kite-studio` image, pushes it to the registry and creates the hosted agent in the Foundry project. These deployment outputs give it what it needs: `acrName`, `acrLoginServer`, `projectEndpoint`, `foundryAccountName`, `anthropicBaseUrl` and `answerDeployment`. To print them, run this command:

```bash
az deployment group show --resource-group rg-kite --name kite --query properties.outputs -o json
```

Then run it. Claude Code in the agent builds the director's-cut movies and brand-new games with Opus 5.5 (`directorDeployment`) and keeps Haiku for its own small internal calls:

```bash
ACR_NAME=<acrName> FOUNDRY_PROJECT_ENDPOINT=<projectEndpoint> ANTHROPIC_FOUNDRY_RESOURCE=<foundryAccountName> \
	OPUS_DEPLOYMENT=claude-opus-5-5 HAIKU_DEPLOYMENT=claude-haiku-5-5 scripts/deploy-studio-agent.sh
```

The template already gives the project's managed identity **AcrPull** on the registry, which lets the platform pull the agent image. It also connects Application Insights to the project for agent traces. Your Azure AI User role lets you create the agent. Owner and Contributor alone can't, because creating an agent is a data-plane operation.

The agent's own identity exists only after the agent does, so the template can't grant it anything. Claude Code inside the agent calls the account's `/anthropic` endpoint, which the agent's default project access may not cover. If the agent gets HTTP 401 or 403 from Claude, grant its identity Azure AI User on the Foundry account. The role ID below is Azure AI User, which Microsoft is renaming to Foundry User.

```bash
az role assignment create --assignee <agent-principal-id> --role 53ca6127-db72-4b80-b1b0-d745d6d5456d \
	--scope "$(az cognitiveservices account show -g rg-kite -n <foundryAccountName> --query id -o tsv)"
```

## Deploy the brain and web apps

Do this on Sunday, after the brain and web images exist.

1. Build the brain image in the registry. `az acr build` builds on Azure, so you don't need Docker. The build context is the repo root, because the image also carries `COLLAB_LOG.md`, `docs/trust/` and `packages/movie`. `.dockerignore` keeps every `.env` out.

	```bash
	az acr build --registry <acrName> --image kite-brain:latest -f brain/Dockerfile .
	```

	The image holds `brain/data/demo-snapshot.db` (as `data/kite.db`) and `brain/data/concept_vectors.npy` when they exist at build time. Checkpoint the snapshot first, so no `-wal` file is left behind: `sqlite3 brain/data/demo-snapshot.db "PRAGMA wal_checkpoint(TRUNCATE)"`. The movie renderer's `npm ci` is skipped until `packages/movie` exists.

2. Build the web image. Its build context is the repo root too, because the web app compiles the workspace packages (`packages/client`, `packages/games`, `packages/movie`) from source. The image runs Next's standalone server and reads `BRAIN_URL` at request time.

	```bash
	az acr build --registry <acrName> --image kite-web:latest -f apps/web/Dockerfile .
	```

3. Deploy the apps. The script reads `ELEVENLABS_API_KEY`, `KITE_MASTER_KEY`, `OPENROUTER_KEY` and `KITE_VOICES` from `brain/.env` and stores the keys as Container Apps secrets.

	```bash
	KITE_DEPLOY_APPS=true infra/deploy.sh
	```

	The script prints the brain and web URLs. The web app gets the brain's URL in `BRAIN_URL`.

Each app runs one replica, because the brain's event bus lives in memory. Keep `KITE_DEPLOY_APPS=true` on every later run, or the deployment skips the apps and leaves their settings unchanged. To roll out a new image under the same tag, run this command:

```bash
az containerapp update --resource-group rg-kite --name kite-brain --image <acrLoginServer>/kite-brain:latest
```

## What it costs

These figures are estimates for a hackathon weekend, not measurements.

- Claude Sonnet 5.5 costs $2 per million input tokens and $10 per million output tokens. Claude Haiku 5.5 costs $0.10 and $0.50. Anthropic publishes these rates on its [pricing page](https://platform.claude.com/docs/en/about-claude/pricing), and Azure bills them as Claude Consumption Units on your Azure invoice.
- Microsoft-Decision-1 costs about $0.04 per million input tokens, and output is free. These figures come from third-party sites, not from Microsoft.
- Embeddings, Content Safety, Log Analytics and the Basic registry cost a few dollars at most over a weekend.
- The two Container Apps run all the time once deployed. The brain uses 2 vCPUs and 4 GiB, roughly $5 a day.
- A hosted agent session bills for CPU and memory only while it runs. Its compute stops after 15 idle minutes.

Expect the weekend to cost less than $50, most of it Claude tokens from the night shift. To see the real figure, open **Cost Management** in the Azure portal.

## Delete everything

1. Delete the resource group.

	```bash
	az group delete --name rg-kite --yes
	```

2. List the deleted Foundry accounts. A deleted account holds its Claude quota for up to 48 hours and keeps its name taken.

	```bash
	az cognitiveservices account list-deleted -o table
	```

3. Purge the Kite account.

	```bash
	az cognitiveservices account purge --location eastus2 --resource-group rg-kite --name <foundryAccountName>
	```

## Fix common failures

- If a deployment fails with `InsufficientQuota`, lower that model's capacity in `infra/main.bicepparam` or request more quota.
- If a Claude deployment fails with a subscription eligibility error, the subscription type or billing country can't buy Claude. Use a pay-as-you-go subscription in a supported country.
- If a model deployment fails with `GatewayTimeout`, it can still finish in the background. Check it with `az cognitiveservices account deployment list -g rg-kite -n <foundryAccountName> -o table`, then rerun `infra/deploy.sh`.
- If the custom subdomain is taken after a teardown, purge the deleted account and rerun.
