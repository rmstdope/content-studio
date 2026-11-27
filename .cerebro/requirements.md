# Requirements

Agreed with the navigator 2026-11-27. Each requirement keeps its ID for ever;
a dropped one is struck, never renumbered.

## Starting the studio (RUN)

~~RUN-1  Running `content-studio` anywhere inside a game repository finds its content-studio.json,
       starts the studio on this computer only and opens it in the browser. Without a project
       file it says so.~~ dropped 2026-11-27
RUN-2  A problem in the project file or in a file it points to is reported with the file and the
       place in it, instead of the studio failing.
       Proven by: test/system/RUN-2.test.ts

## Safety in the game repository (SAF)

SAF-1  The studio writes only the files the project file names and its own files in
       content-studio/, never anything outside the project root, and never changes git. The
       person commits.
       Proven by: test/system/SAF-1.test.ts
SAF-2  Only the studio's own page can change anything: a change asked for by another web page or
       address is refused.
       Proven by: test/system/SAF-2.test.ts
SAF-3  No clip is deleted unless the person confirms it first.
       Proven by: test/system/SAF-3.test.ts

## Overview and changes (OVW)

OVW-1  A part's overview shows what is missing or out of date for that part, so the person knows
       what is left to do.
       Proven by: nothing yet
OVW-2  The Changes page lists what git sees of the files the studio wrote, so the person knows
       what to commit.
       Proven by: nothing yet
OVW-3  A greyed control says why it is off, on hover, focus or tap, and stays reachable with Tab.
       Proven by: nothing yet

## Setup (SET)

SET-1  Setup shows every tool, key and model each kind of content needs, whether it is there, and
       how to install what is missing.
       Proven by: test/system/SET-1.test.ts
SET-2  The person chooses the models for narration (audition, draft, final), music, images and
       sound effects on Setup, and the choice is saved in the project file.
       Proven by: test/system/SET-2.test.ts

## Casting voices (CST)

CST-1  Each character has one page with its cast voice, its lines per part, its delivery (style
       and speed) and the audition in progress, if there is one.
       Proven by: nothing yet
CST-2  The person auditions voices for a character (found by keywords in Fish Audio's or
       ElevenLabs' library, their own voices, a cloned voice or a designed one) by hearing each
       say the audition phrase, shortlisting some and ruling others out, and casts one.
       Proven by: nothing yet
CST-3  A voice ruled out for a character stays ruled out for it and is not offered again; the
       character's page lists the voices ruled out.
       Proven by: test/system/CST-3.test.ts
CST-4  The person can switch on clean-up of a cast voice and set its level, hearing the
       difference first. Cleaning the lines already in the game asks first, and they can be put
       back.
       Proven by: test/system/CST-4.test.ts

## Narration (NAR)

NAR-1  The person records the narration of one character or of a whole part, in each language the
       game declares. Only lines that are missing or whose inputs changed are recorded; clips
       whose line left the script are removed.
       Proven by: test/system/NAR-1.test.ts
NAR-2  Each take is checked with Whisper and made again until enough of its words are heard. The
       manifest the game reads keeps its format and gets real word timings.
       Proven by: test/system/NAR-2.test.ts
NAR-3  The person can set a line's delivery cue, a character's style and speed, pronunciations
       and the words that sound the same; the lines these change then show as out of date.
       Proven by: nothing yet
NAR-4  The person can hear a character's recorded lines as the game plays them, one by one or all
       in turn.
       Proven by: nothing yet

## Spending (SPD)

SPD-1  Anything paid (a recording, an audition, an ElevenLabs take) first says what it can cost,
       and is held to the limit the person agreed.
       Proven by: test/system/SPD-1.test.ts
SPD-2  The Spending page shows what has been spent, dollars and credits apart.
       Proven by: test/system/SPD-2.test.ts

## Music (MUS)

MUS-1  Each loop and stinger the game lists can be made as takes, with a local model or Eleven
       Music, from a brief the person can edit. The person listens and chooses a take, and the
       chosen take is the track the game gets.
       Proven by: test/system/MUS-1.test.ts
MUS-2  A take can be trimmed and faded before it goes to the game.
       Proven by: nothing yet
MUS-3  Make all makes takes for every track of an act that has none, and can be stopped.
       Proven by: nothing yet

## Images (IMG)

IMG-1  Each image the game lists can be made as takes with a local model, in the act's style,
       which the person sets. The person chooses a take, and the game gets it at the listed size
       and in the palette.
       Proven by: test/system/IMG-1.test.ts
IMG-2  Patches: the person marks part of a chosen picture and has a change painted into it,
       compares the patch's takes and chooses one for the game.
       Proven by: nothing yet
IMG-3  Fine-tune: the person makes variations of a picture, compares them and chooses or drops
       each; Choose and Drop stay off for a second on a card that has just turned ready, and a
       choice can be undone.
       Proven by: nothing yet
IMG-4  Named areas: the person places a box (and a point, where it has one) for each area the game
       names on the picture, and they are saved for the game with the image.
       Proven by: nothing yet
IMG-5  Movement: the person puts effects and a slow zoom on a picture, with their settings and
       where each plays, and sees them move as the game shows them; each change is saved for the
       game at once.
       Proven by: nothing yet
IMG-6  Make all makes takes for every image of an act that has none, and can be stopped.
       Proven by: nothing yet
IMG-7  When the act's look changes, the chosen pictures and their patches can be brought to the
       new look, and the studio says which could not be.
       Proven by: nothing yet

## Sound effects (SFX)

SFX-1  Each sound effect the game lists can be made as takes with a local model, from a
       description the person can reword. The person chooses a take for the game; a looping
       effect loops without a seam.
       Proven by: test/system/SFX-1.test.ts
SFX-2  A take can be trimmed and faded, and an effect's level set, before it goes to the game.
       Proven by: nothing yet
SFX-3  Make all makes takes for every effect that has none, and can be stopped.
       Proven by: test/system/SFX-3.test.ts

## Scenes (SCN)

SCN-1  The person hears a scene's music, effects and narration together as the game plays them,
       and sets the level of each; the levels are saved in the act's mix, the one scenes file the
       studio writes.
       Proven by: test/system/SCN-1.test.ts
SCN-2  Each scene's loudness is measured against the project's target, and the page shows which
       scenes are off it or not measured since they changed.
       Proven by: nothing yet

## Refresh from the game (RFR)

RFR-1  Refresh dialog on a part's page runs the game's own command to rewrite that part's dialog,
       and the studio then shows what changed. A command that takes too long is stopped, with
       nothing left running.
       Proven by: test/system/RFR-1.test.ts
RFR-2  Refresh from the game on an act's Music, Images and Scenes pages, and on the Stingers and
       Sound effects pages, runs the game's own command to rewrite its lists; each page reports
       only its own list's changes. The studio runs nothing else of the game's.
       Proven by: test/system/RFR-2.test.ts

## Working with an AI agent (AGT)

AGT-1  An AI agent connected to the studio over MCP can read what every page shows and do the
       studio's own steps, with the same checks as the page. A step that deletes clips is done
       only on a call marked confirmed, once the person has agreed.
       Proven by: test/system/AGT-1.test.ts
AGT-2  A page open in the browser follows what an agent changed, without being reloaded.
       Proven by: nothing yet
