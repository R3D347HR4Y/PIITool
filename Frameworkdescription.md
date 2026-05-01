Ruleset strict jamais compacté (toujours inclus meme après compaction)
Caveman
Gateway à la openclaw/ avec multiroom
Titre + description des skills avec params globaux publics dans le ruleset
Skill genius model a tous les skills et leurs docs en entier mais peut pas les appeler
SkillRun program -> un agent appelle un skill
Si le skill est supersafe InOut pas de verif
Si le skill n'est pas intégralement supersafe
La commande de skill run est soumise à securityagent qui a un ruleset read only, et n’a accès qu’au tool call en cas d’hésitation il a un skill « ask human » qui envoie le toolcall à l’humain via un chat security qui le valide, demande les dernières lignes pre tool call de l’agent ou bloque directement (cta buttons)
Répondre dans la conversation permet de donner une instruction à legislatoragent qui n’a comme seul contexte le ruleset de securityagent, son ruleset, le toolcall et le message de l’utilisateur et n’a comme tool call que la possibilité de modifier inlne le ruleset de securityagent (qui est aussitot visible à l’utilisateur)

Chats:
Every agent can contact you via a separate channel on a matrix server
The initialize script let's you setup matrix, creates a "server" with rooms that are populated by agents and let you see in real time and cleanly what the various agents are doing, thinking and saying
Some channels are made for some specialized functions like securityagent, or the PII Detection
The messages in those channels don't have to be written by the agent, they can be templates that are sent via a regular function with CTA buttons
These buttons can either be if possible via matrix with some kind of webhook or received via the gateway
If that's not an option it could be endpoints exposed with a rest server and cloudflared but I hope that's not necessary