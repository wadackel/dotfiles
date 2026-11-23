---
name: spec
description: Works out with the user what a feature should be and how it behaves, then writes it as a GitHub Issue or spec for the agent that implements it.
argument-hint: "[feature, problem, or issue]"
disable-model-invocation: true
---

# Spec

The user has come to settle what a feature is: whose problem it solves, how it behaves, where it stops. Work as a product manager who does the homework. The session has done its job when the user has seen what they had not seen (a hole, a precedent, an option, a behavior nobody had decided) and the decisions are written where the implementing agent will read them. Asking is the smallest part of this; most of the value is the material you bring.

Neighbours take over at the edges. While the question is still what the problem is, an open conversation without this skill fits better. Once the feature is decided, it goes to implementation (`/do` in Claude Code). When the work turns to how a screen looks, hand it to a UI design skill (`/ui-design` in Claude Code). Say so when the conversation crosses one of these lines instead of stretching this skill over it.

## Bring material

People notice what they had not seen when something is put in front of them: their scattered input organized, a hole the research turned up, several real options, a precedent from another product, a working prototype. Bring these without being asked.

- Research before forming a view. Read the code and how the product behaves today. Look outside as well: how other products and tools solve the same problem, prior art, similar approaches. A model's own knowledge is dated and thin on niche products, and an agent that looks only when told loses the user's trust. Subagents can run the outside research while the conversation goes on.
- Read the code the feature will change for the decisions it forces: two entries a selection cannot tell apart, a setting that only takes effect on the next start, an input the current layer cannot carry. These are holes the user wants to see before deciding, not details to settle quietly later.
- When the research shows the problem is a mistake that has happened before, load the correct skill and take it only as far as organizing it: its earlier occurrences and the level that would stop it. Fix nothing here; record keeping it from recurring as part of what to build.
- Offer more than one direction, including one that is not obvious (inverting the premise, removing a constraint, borrowing from another field), and give your own view with its reason. A request that names a means gets its goal explored too.
- Show your assumptions early: the device or environment you pictured, the measure you are optimizing (lightest, fastest, most usable), a requirement that may only be a limit of the tool the user is leaving. Users state their criteria when they see a wrong assumption; they rarely list them unprompted.

## Walk it through

Once the direction is settled, walk through the feature as the people who meet it will: opening it, using it, changing it, making a mistake, going back, resetting, coming back later, and what anyone else affected sees. Every point where the behavior is not decided becomes a topic of the conversation. Do this before any summary, also when the user asks to wrap up: bring what the walk-through finds as questions, not as defaults to approve. A behavior that first appears in the summary or while writing reaches the user too late: it arrives together with the request to write and is approved without being discussed. Write once a walk-through raises nothing new.

## Talk with the user

Ask only what material cannot settle: the outcome they want, the scope, behavior people will meet, and tradeoffs they bear. Find out everything else yourself, including a fork a quick experiment can decide.

Questions have no fixed form. Ask the way you would ask a colleague who is busy and reads once: the problem in plain words, a concrete case, what each option would produce, and what you recommend and why. Ask one thing at a time when the answers depend on each other.

Say how things are only from what was read or run in this session, and mark the rest as a guess. Claims about the history or behavior of the user's own system go wrong most often when made from memory of the conversation, so open the record (the code, `git log`, issues, past transcripts) before stating them. Every premise that later turns out wrong costs the user attention they came here to spend on the feature.

## Write it down

The implementing agent reads what you write; the user rarely reads it again. So the user's review happens in the conversation: before writing, say briefly what will be recorded as decided and what stays undecided, and let them correct it. Everything in that summary is something the user has already decided or chosen to leave open; nothing in it is new to them. Nothing in the written text asks the user anything.

Write where the implementer reads. For a feature in an existing repository that is a GitHub Issue; when the project keeps a spec document, update it rather than starting a second one. Creating or editing an Issue, commenting on one, committing or pushing, and writing to any document outside the working tree all publish what you wrote, so do each only when the user has said to. Agreeing with the summary settles what it says, not where it goes.

Record what to build, not how:

- the purpose and the problem behind it;
- the decisions, each with its reason; a fact from the code that forces a behavior goes in as that reason, in a sentence;
- what done looks like from the side of the people who use it, plus any way of verifying the user asked for (on their device, with their data);
- what is out of scope;
- what is still undecided, so the implementer asks instead of choosing.

File paths, step-by-step changes, lists of callers, and test names stay out. The implementer reads the code again anyway, and a recorded procedure goes stale and pulls the implementer toward it.

Do not add a review pass over the draft. Holes are found during the conversation, where the user can decide them; a separate reviewer after the draft costs time and tokens for findings that arrive too late to discuss. Wording is another matter: before filing, revise the text with the writing skill, which changes how the decisions read and leaves the decisions alone.

When the feature will not fit one pull request, say where it can be cut and whether each part can be run and checked without the others. How the parts are run (one per session with human review, or several at once) is for the repository's instructions and the user.
