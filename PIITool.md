The role of the PII Tool is to protect users that don't want their personally identifiable information, or that of their relatives, friends, colleagues, partners, customers etc... to be leaked over to AI Companies like Anthropic, OpenAI, Google etc... while still using their powerful models and giving them access to skills, MCPs and tools that can browse their machine which would usually expose very personal information.
To do so we leverage their hardware's ability to run small local ai models fit for small and privacy minded tasks like identifying and classifying the PIIs, generating alternate fake PIIs and running a database to dynamically replace those with realistic placeholders for the big public LLMs to see.
It has functions for forwards and backwards filtering
Forward filtering is the act of taking text that contains real PIIs and replacing those with auto-generated and coherent placeholder PIIs so as not to expose the real ones to the LLM
Backward filtering is the act of of taking text that contains placeholder PIIs and replacing those with their matching real PIIs so that tool calls and user messages contain the appropriate names and info to work properly.

PII filter:
Forward filters: Tool Calls, Gateway User messages, file reads, conversation histories
Backward filters: Tool responses, Gateway Agent messages, File writes

PII detector agent:
Local LLM with saved system prompt that takes in an input text and outputs a json list of identified people, company names, domains, emails, username/handles of social networks even unknown, links, format of data, phone numbers, language/region and all possible data that would be stored in the PIIDB
The JSON format should contain the people and companies with their associated PIIs
For example a sentence like "John doe is in the hallway of blackwater labs with meryl and sent her an email to meryl.l@blackwaterlab.eu" would turn into:
```
{
  people: [
  {
  id: 1,
  firstName: "john",
  lastName: "doe"
  },
  {
  id:2,
  firstName: "meryl",
  emails: ["meryl.l@blackwaterlab.eu"],
  jobs: [
  {
  employer: "blackwater labs"
  }
  ]
  }
  ],
  companies: [
  {
  id:1,
  companyNames: ["blackwater labs"]
  domains: ["blackwaterlab.eu"]
  }
  ]
}
```



PIIDB:
- Uses a lightweight db that is widely used, easily queried even with fuzzy match, with a schema that can be modified without constantly going through migrations, easily deployed standalone or packaged and portable, if it is more simple, it can also just be a collection of JSON/YAML files if that's good enough for the usecase
- Stores personally identifiable information and has classes for:
	- Companies
		- Legal details, SIRENs, SIRETs, TAX IDs, Addresses, phones, emails, etc...
		- Websites, domain names, email domains
		- Assets, logos (Pointers)
		- Whether the Company is whitelisted
		- Pointer to the mirror "anonymized Company" if company is not whitelisted and vice versa
		- Whether this is a real or anonymizedCompany
	- Persons
		- Legal details, names, tax ids, SSN, personal addresses, professional addresses personal emails, pro emails, phone numbers, alternate spellings, jobs (position & company pointer), relation to user
		- Photos, sound recordings (Pointers)
		- Whether the Person is whitelisted
		- Pointer to the mirror "anonymized Person" if this People is not whitelisted and vice versa
		- Whether this is a real or anonymizedPerson
	 - Assets
		 - Path to the stored asset
		 - Type of asset (audio, photo, PDF)
		 -  Pointer to the mirror "anonymized asset" if this asset is not whitelisted and vice versa
		- Whether this is a real or anonymized asset
The schema is extensible, if there are details that are not included in the original schema (say gender for example) and that the PIIDetector Agent exposes it, then it is added to the db schema and to the constrained schema that is given to PIIDetector Agent in all future prompts
(kinda like the zod schemas to have structured JSON outputs in openAI api)
It stores for every real instance of a Person / Company a "mirror" instance that retains some of the key info (like the gender, origin and / or job title) and has randomized unique but coherent other props like first and last name, a coherent email, a pointer to the right mirror company etc..
So for example let's say I have a real person:
Robin Williams, male Singer at ABC Records, 40 years old, r.williams@abcrecords.com, +1 232 1765, facebook.com/u/robin-williams
And a real company
ABC Records, incorporated in 1987, TAX id: 832923492, based in California, 123 State Street, Monterey Park, domains abcrecords.com
his anonymized mirror would be
Jamie Roberts, male Singer at Raylong Labels, 42 years old, j.roberts@raylonglabels.com, +1 658 8462, facebook.com/u/jamie-roberts
And the mirror of the company would be
Raylong Labels, incorporated in 1992, TAX id: 859265002, based in California, 89 Ruperts Avenue, East Los Angeles
That way the public LLMs only see the anonymized versions of the people and companies, and we replace back and fourth the real and fake ones between the LLMs interactions with the user and with the tool calls so that the users can can talk about the real people that are also mentionned in emails and files, but when the user messages and the tool call responses reach the LLM, they have been replaced with the fake info and when they send tool calls and messages to the user with PIIs of the fake users if gets replaced with the info of the real users before reaching destination



Function: AnonPII
Takes in the JSON PII detector agent outputs, the original content and a boolean (anonymize / deanonymize) and does the following: 
- Detection stage:
	- When a PII matches nothing in DB, new entry with all of that data, with format tagged, DB takes care of some auto formatting upon first entry and alert.prompt the user to check whether to whitelist given new companies and people whether or not they are to be anonymized in outputs then use regex to replace PIIs with anonplaceholders of the exact same format
	- When a PII fuzzymatch on something, alert.prompt the user whether it’s a new user or old one with the possible matches to either merge (with alternate spellings and extra info) or create a new entry
	- When they exactmatch continue
- Replacement stage:
	- Take the input text and replace the instances of the PIIs detected with those of the mirrored version

Tool should be written in a fast lightweight language if possible, could be rust or could be bun if that's good enough and more suited.
If possible it should support streaming inputs and outputs.
If there are existing ways to make it compatible with openclaw / hermes make it so that they are.
The tool should be configurable via envs or a config file (which can be an env file) with the ability to run with most local llm providers (ollama, lmstudio etc…) and most other AI providers like openrouter, openai, claude with configurable endpoints, model choice etc…
This tool will also support images, files and audio
For pictures what we should do is:
- We simply use a local multimodal LLM to describe it very precisely (image contents, text, styles, colors, people, faces, logos etc...) then use anonPII on the output of the LLM, then send that instead of the image

For audio what we should do is:
- Run it through a local running Whisper or other preferred STT service of the user, and run the output through anonPII then return that

