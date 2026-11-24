import { describe, expect, it } from 'bun:test'
import {
  acceptedLineText,
  acceptFailedText,
  leftOutOfDateText,
  sizeStillOutText,
  undoAcceptFailedText,
  areaRowWhy,
  imageMakeWhy,
  imageMenuWhy,
  modelMissingWhy,
  patchMakeWhy,
  patchMenuWhy,
  bringFailureText,
  bringingText,
  finishedLine,
  missingText,
  IMAGE_STATUS_LABEL,
  areaCaptionText,
  areasCountText,
  disagreeText,
  listSeparator,
  joined,
  lookNoticeText,
  makeTakesText,
  modelCaption,
  outOfDateText,
  paletteText,
  takeCountText,
  unchooseNote,
  makeAgainActLine,
  overlapActLine,
  overlapHeading,
  overlapOpenLine,
  overlapPairLine,
  makeAgainOpenLine,
  onTopSuffix,
  onTopLine,
  onTopNoneLine,
  onTopEmpty,
  onTopCaption,
  chosenTakeLabel,
  onTopTake,
  onTopStale,
  onTopQuestionLead,
  onTopQuestionDim,
  onTopActLine,
  joinTitles,
  setAsideDim,
  setAsideLead,
  placeAgainLine,
  setAsideDropSentence,
  setAsideSentence,
  setAsideTitle,
} from './imagesText'
import type { SetAsideQuestion } from '../core/imagePatches'
import { parseRoute, routeHref } from './route'
import { openWorkspace } from './sidebarActs'

describe('the images words', () => {
  it('says how many are finished', () => {
    expect(finishedLine('Act I', 4, 1)).toBe(
      'The images the game asks for in Act I. 1 of 4 finished.',
    )
    expect(IMAGE_STATUS_LABEL.incomplete).toBe('incomplete')
    expect(IMAGE_STATUS_LABEL.unknown).toBe('not known')
    // Which are chosen is not known while the lock cannot be read: no count to give.
    expect(finishedLine('Act I', 4, null)).toBe('The images the game asks for in Act I.')
  })
  it('names what an out-of-date image changed, joined with "and"', () => {
    expect(outOfDateText(['the words'], 'Act I')).toBe(
      'Out of date since it was chosen: the words.',
    )
    expect(outOfDateText(['the words', 'the size'], 'Act I')).toBe(
      'Out of date since it was chosen: the words and the size.',
    )
    expect(outOfDateText(['the words', 'the size', 'the style'], 'Act I')).toBe(
      'Out of date since it was chosen: the words, the size and the style.',
    )
  })
  it('names the act’s style with the act’s name', () => {
    expect(outOfDateText(['the words', 'the act style'], 'Act IV')).toBe(
      "Out of date since it was chosen: the words and Act IV's style.",
    )
  })
  it('joins what changed with and', () => {
    expect(joined(['the look', 'the palette', 'the addition for Act II'])).toBe(
      'the look, the palette and the addition for Act II',
    )
  })
  it('counts the palette', () => {
    expect(paletteText(16)).toBe('16 colours')
    expect(paletteText(1)).toBe('1 colour')
  })
})

describe('the images routes', () => {
  it('round-trips each page', () => {
    for (const route of [
      { view: 'images', page: null },
      { view: 'images', page: 'act', part: 'act 1' },
      { view: 'images', page: 'style' },
      { view: 'images', page: 'image', image: 'silver-stag-inn' },
    ] as const) {
      expect(parseRoute(routeHref(route))).toEqual(route)
    }
  })
  it('opens the images workspace in the sidebar', () => {
    expect(openWorkspace({ view: 'images', page: 'style' })).toBe('images')
  })
})

describe('the image takes words', () => {
  it('counts takes in the menu', () => {
    expect([1, 2, 4].map(takeCountText)).toEqual(['1 take', '2 takes', '4 takes'])
  })
  it('names the make button after the count, and says "more" once there are takes', () => {
    expect(makeTakesText(2, false)).toBe('Make 2 takes')
    expect(makeTakesText(2, true)).toBe('Make 2 more takes')
    expect(makeTakesText(1, true)).toBe('Make 1 more take')
  })
  it('asks what un-choosing does', () => {
    expect(unchooseNote(2)).toBe(
      'The game shows no image here until you choose another. Take 2 stays among the takes.',
    )
  })
})

describe('the game’s look words', () => {
  it('captions the model’s picture, adding that it is cropped', () => {
    expect(modelCaption(1280, 720, false)).toBe('1280 × 720')
    expect(modelCaption(1024, 1024, true)).toBe('1024 × 1024 · cropped to fit')
  })
  it('words the notices as agreed', () => {
    expect(lookNoticeText(14, ['its palette'])).toEqual({
      head: "The game's look changed",
      what: ' (its palette)',
      rest: '14 images and their takes still have the old look. Nothing needs making again.',
    })
    expect(lookNoticeText(1, ['its palette', 'its dithering']).rest).toBe(
      '1 image and its takes still have the old look. Nothing needs making again.',
    )
    expect(bringingText(6, 14)).toBe('Bringing images to the new look… 6 of 14')
    expect(bringFailureText(14, Array(5).fill({ reason: 'missing' }))).toEqual({
      head: 'Brought 9 of 14 images to the new look.',
      rest: "5 couldn't be: the model's picture for each is missing. Their old look stays until you make new takes.",
    })
    expect(
      bringFailureText(3, [
        { reason: `the model's picture of its patch "Bread taken" is missing` },
      ]),
    ).toEqual({
      head: 'Brought 2 of 3 images to the new look.',
      rest: `1 couldn't be: the model's picture of its patch "Bread taken" is missing. Its old look stays until you make new takes.`,
    })
  })
})

describe('the words of an image several acts list', () => {
  it('joins the names the way the lists do', () => {
    expect([0, 1, 2].map((i) => listSeparator(i, 3))).toEqual(['', ', ', ' and '])
    expect([0, 1].map((i) => listSeparator(i, 2))).toEqual(['', ' and '])
  })
  it('names the act style change when a picture is out of date because of it', () => {
    const change = (now: string | null, was: string | null) => ({ now, was })
    expect(outOfDateText(['the act style'], 'Act I', change('Act III', 'Act I'))).toBe(
      "Out of date since it was chosen: Act III's style instead of Act I's.",
    )
    expect(outOfDateText(['the act style'], 'Act I', change(null, 'Act I'))).toBe(
      "Out of date since it was chosen: Act I's style left out.",
    )
    expect(outOfDateText(['the words', 'the act style'], 'Act I', change('Act III', null))).toBe(
      "Out of date since it was chosen: the words and Act III's style.",
    )
  })
  it('says what the lists disagree about', () => {
    expect(disagreeText(['Act I', 'Act III'], ['words'])).toBe(
      "The game's lists disagree about this image: Act I and Act III give it different words. Fix them in the game, then Refresh from the game.",
    )
    expect(disagreeText(['Act I', 'Act III', 'Act V'], ['words', 'sizes'])).toContain(
      'Act I, Act III and Act V give it different words and sizes.',
    )
    expect(disagreeText(['Act I', 'Act III'], ['names'])).toContain('give it different names.')
  })
  it('says named areas among the things the lists disagree about', () => {
    expect(disagreeText(['Act I', 'Act III'], ['words', 'named areas'])).toContain(
      'give it different words and named areas.',
    )
  })
  it('captions the picture of the named areas with its take and what can be done', () => {
    expect(areaCaptionText(8, { title: 'Boats', placed: false })).toBe(
      'Take 8 · drag on the picture to place “Boats”',
    )
    expect(areaCaptionText(8, { title: 'Boats', placed: true })).toStartWith(
      'Take 8 · drag the box to move it',
    )
    expect(areaCaptionText(8, null)).toBe(
      'Take 8 · press an area in the list or on the picture to change it.',
    )
  })
  it('counts the named areas placed and left to place', () => {
    expect(areasCountText(1, 5)).toBe('1 of 5 placed')
  })
  it('names each thing an image still lacks', () => {
    expect(missingText({ patches: 1, areas: 2 })).toBe('1 patch not chosen, 2 areas not placed')
    expect(missingText({ patches: 3, areas: 0 })).toBe('3 patches not chosen')
    expect(missingText({ patches: 0, areas: 1 })).toBe('1 area not placed')
    expect(missingText({ patches: 0, areas: 0 })).toBeNull()
  })
  it('keeps the act an image was opened from in its address', () => {
    expect(routeHref({ view: 'images', page: 'image', image: 'inn', from: 'act3' })).toBe(
      '#/images/items/inn?from=act3',
    )
    expect(parseRoute('#/images/items/inn?from=act3')).toEqual({
      view: 'images',
      page: 'image',
      image: 'inn',
      from: 'act3',
    })
    expect(parseRoute('#/images/items/inn')).toEqual({
      view: 'images',
      page: 'image',
      image: 'inn',
    })
  })
})

describe('the questions about patches set aside', () => {
  it('counts the patches and says what the game does', () => {
    expect(setAsideSentence(2, 3)).toBe(
      '3 chosen patches were made on take 2. The game will stop showing them until you make new ones.',
    )
    expect(setAsideSentence(2, 1)).toBe(
      '1 chosen patch was made on take 2. The game will stop showing it until you make a new one.',
    )
  })
  it('says how to bring them back, and what comes back with the take chosen', () => {
    const q = (leaving: string[], to: number | null, returning: string[]) => ({
      from: 2,
      leaving,
      to,
      returning,
      leavingAreas: [],
      returningAreas: 0,
    })
    expect(setAsideDim(q(['A', 'B', 'C'], 4, []))).toBe(
      'Choosing take 2 again brings them all back.',
    )
    expect(setAsideDim(q(['A'], null, []))).toBe('Choosing take 2 again brings it back.')
    expect(setAsideDim(q(['Bread taken'], 1, ['Door open', 'Lamp lit']))).toBe(
      '2 patches made on take 1 come back: Door open, Lamp lit. Choosing take 2 again brings Bread taken back.',
    )
    expect(setAsideDim(q(['Bread taken', 'Well'], 1, ['Door open']))).toBe(
      '1 patch made on take 1 comes back: Door open. Choosing take 2 again brings Bread taken and Well back.',
    )
  })
  it('titles the questions', () => {
    expect(setAsideTitle({ kind: 'choose', n: 4 }, 2)).toBe('Choose take 4?')
    expect(setAsideTitle({ kind: 'drop', n: 2 }, 2)).toBe('Drop take 2?')
    expect(setAsideTitle({ kind: 'unchoose' }, 2)).toBe('Un-choose take 2?')
  })
  it('says a drop cannot be taken back', () => {
    expect(setAsideDropSentence(2, 3)).toBe(
      '3 chosen patches were made on take 2. After this they cannot be brought back; only new ones can be made.',
    )
    expect(setAsideDropSentence(2, 1)).toBe(
      '1 chosen patch was made on take 2. After this it cannot be brought back; only a new one can be made.',
    )
  })
})

describe('the marks of a patch to make again', () => {
  it('names them on the act’s row', () => {
    expect(makeAgainActLine(['Bread taken', 'Door open'])).toBe(
      'make again: Bread taken, Door open',
    )
  })
  it('says where the patch was chosen and how to get it back', () => {
    expect(makeAgainOpenLine([2], 4)).toBe(
      'Chosen on take 2 of the image, so the game does not show it now. Make a new one here, or choose take 2 again to bring it back.',
    )
    expect(makeAgainOpenLine([1, 2], 4)).toBe(
      'Chosen on takes 1 and 2 of the image, so the game does not show it now. Make a new one here, or choose one of those takes again to bring it back.',
    )
    expect(makeAgainOpenLine([2], null)).toBe(
      'Chosen on take 2 of the image, so the game does not show it now. Choose take 2 again to bring it back.',
    )
    expect(makeAgainOpenLine([1, 2], null)).toBe(
      'Chosen on takes 1 and 2 of the image, so the game does not show it now. Choose one of those takes again to bring it back.',
    )
    expect(makeAgainOpenLine([], 4)).toBe(
      'Chosen on an earlier take of the image, so the game does not show it now. Make a new one here.',
    )
  })
})

describe('overlapping patches', () => {
  const pairs: [string, string][] = [
    ['Bread taken', 'Door ajar'],
    ['Bread taken', 'Fire out'],
    ['Door ajar', 'Fire out'],
  ]
  it('says one overlap in its heading and several in a shorter one', () => {
    expect(overlapHeading(pairs.slice(0, 1))).toBe(
      'Two chosen patches overlap: Bread taken and Door ajar.',
    )
    expect(overlapHeading(pairs)).toBe('Some chosen patches overlap.')
  })
  it('writes a pair, and an open patch’s line naming what it overlaps', () => {
    expect(overlapPairLine(pairs[1]!)).toBe('Bread taken and Fire out')
    expect(overlapOpenLine(['Door ajar'])).toBe('The chosen take overlaps Door ajar.')
    expect(overlapOpenLine(['Door ajar', 'Fire out'])).toBe(
      'The chosen take overlaps Door ajar and Fire out.',
    )
    expect(overlapOpenLine(['Door ajar', 'Fire out', 'Lamp lit'])).toBe(
      'The chosen take overlaps Door ajar, Fire out and Lamp lit.',
    )
  })
  it('writes the act row’s line with the pairs separated by semicolons', () => {
    expect(overlapActLine(pairs.slice(0, 1))).toBe('patches overlap: Bread taken and Door ajar')
    expect(overlapActLine(pairs)).toBe(
      'patches overlap: Bread taken and Door ajar; Bread taken and Fire out; Door ajar and Fire out',
    )
  })
})

describe('the questions about named areas set aside', () => {
  const q = (over: Partial<SetAsideQuestion> = {}): SetAsideQuestion => ({
    from: 2,
    leaving: [],
    to: 4,
    returning: [],
    leavingAreas: ['Well', 'Gate', 'Bell', 'Door', 'Sign'],
    returningAreas: 0,
    ...over,
  })
  const choose = { kind: 'choose', n: 4 } as const
  const unchoose = { kind: 'unchoose' } as const
  const drop = { kind: 'drop', n: 2 } as const

  it('says what the game does with the areas, on Choose, Un-choose and Drop', () => {
    expect(setAsideLead(choose, q())).toBe(
      '5 named areas are placed on take 2. The game will stop using them until you place them on take 4.',
    )
    expect(setAsideLead(choose, q({ leavingAreas: ['Well'] }))).toBe(
      '1 named area is placed on take 2. The game will stop using it until you place it on take 4.',
    )
    expect(setAsideLead(unchoose, q({ to: null }))).toBe(
      '5 named areas are placed on take 2. The game will stop using them until you place them on another take.',
    )
    expect(setAsideLead(unchoose, q({ to: null, leavingAreas: ['Well'] }))).toBe(
      '1 named area is placed on take 2. The game will stop using it until you place it on another take.',
    )
    expect(setAsideLead(drop, q({ to: null }))).toBe(
      '5 named areas were placed on take 2. After this they cannot be brought back; only new ones can be placed.',
    )
    expect(setAsideLead(drop, q({ to: null, leavingAreas: ['Well'] }))).toBe(
      '1 named area was placed on take 2. After this it cannot be brought back; only a new one can be placed.',
    )
  })
  it('says it once for patches and areas together, each noun in its own number', () => {
    const both = q({ leaving: ['A', 'B', 'C'] })
    expect(setAsideLead(choose, both)).toBe(
      'Take 2 has 3 chosen patches and 5 placed named areas. The game will stop showing the patches and stop using the areas until you make and place them again.',
    )
    expect(setAsideLead(unchoose, q({ leaving: ['A'], leavingAreas: ['Well'], to: null }))).toBe(
      'Take 2 has 1 chosen patch and 1 placed named area. The game will stop showing the patch and stop using the area until you make and place them again.',
    )
    expect(setAsideLead(choose, q({ leaving: ['A'] }))).toBe(
      'Take 2 has 1 chosen patch and 5 placed named areas. The game will stop showing the patch and stop using the areas until you make and place them again.',
    )
    expect(setAsideLead(drop, q({ leaving: ['A', 'B', 'C'], to: null }))).toBe(
      'Take 2 has 3 chosen patches and 5 placed named areas. After this they cannot be brought back; only new ones can be made and placed.',
    )
  })
  it('keeps the words of the patch question when no area is in it', () => {
    const only = q({ leaving: ['A', 'B'], leavingAreas: [] })
    expect(setAsideLead(choose, only)).toBe(setAsideSentence(2, 2))
    expect(setAsideLead(drop, only)).toBe(setAsideDropSentence(2, 2))
  })
  it('says how to bring them back, and counts what comes back', () => {
    expect(setAsideDim(q())).toBe('Choosing take 2 again brings them all back.')
    expect(setAsideDim(q({ leavingAreas: ['Well'] }))).toBe('Choosing take 2 again brings it back.')
    expect(setAsideDim(q({ leaving: ['A'] }))).toBe('Choosing take 2 again brings them all back.')
    expect(setAsideDim(q({ returningAreas: 5, to: 4 }))).toBe(
      '5 named areas placed on take 4 come back. Choosing take 2 again brings back what leaves now.',
    )
    expect(setAsideDim(q({ returningAreas: 1, to: 4 }))).toBe(
      '1 named area placed on take 4 comes back. Choosing take 2 again brings back what leaves now.',
    )
    expect(
      setAsideDim(
        q({
          leavingAreas: [],
          leaving: ['A'],
          to: 1,
          returning: ['Door open', 'Lamp lit'],
          returningAreas: 5,
        }),
      ),
    ).toBe(
      '2 patches made on take 1 come back: Door open, Lamp lit. 5 named areas placed on take 1 come back. Choosing take 2 again brings back what leaves now.',
    )
    expect(setAsideDim(q({ to: 1, returning: ['Door open', 'Lamp lit'] }))).toBe(
      '2 patches made on take 1 come back: Door open, Lamp lit. Choosing take 2 again brings back what leaves now.',
    )
  })
})

describe('the line over the areas to place again', () => {
  it('says where they were placed and how to get them back', () => {
    expect(placeAgainLine([2], 4, 5)).toBe(
      'Placed on take 2 of the image, so the game does not use them now. Place them here, or choose take 2 again to bring them back.',
    )
    expect(placeAgainLine([2], 4, 1)).toBe(
      'Placed on take 2 of the image, so the game does not use it now. Place it here, or choose take 2 again to bring it back.',
    )
    expect(placeAgainLine([1, 2], 4, 3)).toBe(
      'Placed on takes 1 and 2 of the image, so the game does not use them now. Place them here, or choose one of those takes again to bring them back.',
    )
    expect(placeAgainLine([2], null, 3)).toBe(
      'Placed on take 2 of the image, so the game does not use them now. Choose take 2 again to bring them back.',
    )
    expect(placeAgainLine([1, 2], null, 1)).toBe(
      'Placed on takes 1 and 2 of the image, so the game does not use it now. Choose one of those takes again to bring it back.',
    )
  })
  it('names no take when they were placed on one since dropped', () => {
    expect(placeAgainLine([], 4, 3)).toBe(
      'Placed on an earlier take of the image, so the game does not use them now. Place them here.',
    )
    expect(placeAgainLine([], 4, 1)).toBe(
      'Placed on an earlier take of the image, so the game does not use it now. Place it here.',
    )
    expect(placeAgainLine([], null, 3)).toBe(
      'Placed on an earlier take of the image, so the game does not use them now.',
    )
  })
})

describe('patchMenuWhy', () => {
  const free = { makerMessage: null, making: false, savingWords: false }
  it('is nothing while the patch can take new takes', () => {
    expect(patchMenuWhy(free)).toBeNull()
  })
  it('names the maker first, then the takes being made, then the words saving', () => {
    const all = { makerMessage: 'mflux is not installed.', making: true, savingWords: true }
    expect(patchMenuWhy(all)).toBe('mflux is not installed.')
    expect(patchMenuWhy({ ...all, makerMessage: null })).toBe(
      'Takes are being made for this patch. Change this when they are done, or Stop.',
    )
    expect(patchMenuWhy({ ...all, makerMessage: null, making: false })).toBe(
      'The patch’s words are being saved. This turns on when they are.',
    )
  })
})

describe('patchMakeWhy', () => {
  const free = {
    makerMessage: null,
    modelName: 'Flux Fill',
    modelHere: true,
    mark: 'placed' as const,
    areaTitle: null,
    making: false,
    savingWords: false,
  }
  it('is nothing while Make can be pressed', () => {
    expect(patchMakeWhy(free)).toBeNull()
  })
  it('puts what Setup fixes first, then the mark, then the waiting', () => {
    const all = {
      ...free,
      makerMessage: 'The maker is not ready.',
      modelHere: false,
      mark: 'none' as const,
      areaTitle: 'Locket appears',
      making: true,
      savingWords: true,
    }
    expect(patchMakeWhy(all)).toBe('The maker is not ready.')
    const noMaker = { ...all, makerMessage: null }
    expect(patchMakeWhy(noMaker)).toBe(
      'Flux Fill is not on this computer. Setup says how to download it.',
    )
    const here = { ...noMaker, modelHere: true }
    expect(patchMakeWhy(here)).toBe(
      '“Locket appears” has no place yet. Mark it under Named areas, or drag over the picture to mark this patch.',
    )
    expect(patchMakeWhy({ ...here, areaTitle: null })).toBe(
      'This patch has no mark yet. Drag over the picture to mark where it goes.',
    )
    const marked = { ...here, mark: 'placed' as const }
    expect(patchMakeWhy(marked)).toBe(
      'Takes are being made for this patch. Make more when they are done, or Stop.',
    )
    expect(patchMakeWhy({ ...marked, making: false })).toBe(
      'The patch’s words are being saved. Make turns on when they are.',
    )
  })
  it('names the model in the words Setup uses', () => {
    expect(modelMissingWhy('Klein')).toBe(
      'Klein is not on this computer. Setup says how to download it.',
    )
  })
})

describe('imageMenuWhy and imageMakeWhy', () => {
  const none = { generatorOk: true, making: false, savingWords: false }
  it('are nothing while the image can take new takes', () => {
    expect(imageMenuWhy(none)).toBeNull()
    expect(imageMakeWhy(none)).toBeNull()
  })
  it('put the generator first, then the takes being made, then the words saving', () => {
    const all = { generatorOk: false, making: true, savingWords: true }
    expect(imageMakeWhy(all)).toBe(
      'No image model can run on this computer. Setup says what is missing.',
    )
    expect(imageMenuWhy({ ...all, generatorOk: true })).toBe(
      'Takes are being made for this image. Change this when they are done, or Stop.',
    )
    expect(imageMakeWhy({ ...all, generatorOk: true })).toBe(
      'Takes are being made for this image. Make more when they are done, or Stop.',
    )
    expect(imageMakeWhy({ ...all, generatorOk: true, making: false })).toBe(
      'The image’s words are being saved. Make turns on when they are.',
    )
    expect(imageMenuWhy({ ...all, generatorOk: true, making: false })).toBe(
      'The image’s words are being saved. This turns on when they are.',
    )
  })
})

describe('areaRowWhy', () => {
  it('says which take is not known while the lock cannot be read', () => {
    expect(areaRowWhy('unknown')).toBe(
      'Which take the game shows is not known until the images lock can be read; fix it, then reload.',
    )
  })

  it('says what keeps a named area from being picked, nothing when the picture is ready', () => {
    expect(areaRowWhy('ready')).toBeNull()
    expect(areaRowWhy('loading')).toBe('The picture is still loading. Pick an area when it has.')
    expect(areaRowWhy('gone')).toBe(
      "The chosen take's picture is missing or cannot be read, so areas cannot be placed on it.",
    )
    expect(areaRowWhy('none')).toBe(
      'Choose a take of the image first. Areas are placed on the take the game shows.',
    )
  })
})

describe('patches on top of patches', () => {
  it('names what a patch lies on in its chip and its side list', () => {
    expect(onTopSuffix('Vines cut')).toBe('· on Vines cut')
  })
  it('says what the open patch is painted on, at any depth', () => {
    expect(onTopLine([{ title: 'Vines cut', n: 1 }])).toBe(
      'The game asks for this on top of Vines cut, so it is painted on Vines cut’s chosen take (take 1).',
    )
    expect(
      onTopLine([
        { title: 'Vines cut', n: 1 },
        { title: 'Stick', n: 2 },
      ]),
    ).toBe(
      'The game asks for this on top of Stick, so it is painted on Stick’s chosen take (take 2), which is on top of Vines cut (take 1).',
    )
    expect(
      onTopLine([
        { title: 'Vines cut', n: 1 },
        { title: 'Stick', n: 2 },
        { title: 'Snare', n: 4 },
      ]),
    ).toBe(
      'The game asks for this on top of Snare, so it is painted on Snare’s chosen take (take 4), which is on top of Stick (take 2), which is on top of Vines cut (take 1).',
    )
  })
  it('says the patch underneath has no chosen take, and what the empty box says', () => {
    expect(onTopNoneLine('Vines cut')).toBe(
      'The game asks for this on top of Vines cut, which has no chosen take yet. Choose a take of Vines cut first.',
    )
    expect(onTopEmpty('Vines cut', 'Stick')).toBe(
      'Nothing to paint on yet: Vines cut has no chosen take. Open Vines cut and choose one; Stick is then painted over it.',
    )
  })
  it('captions the picture and the takes', () => {
    expect(onTopCaption('Stick', [{ title: 'Vines cut', n: 1 }])).toBe(
      'Stick, painted on Vines cut (take 1) on the image’s take',
    )
    expect(onTopTake('FLUX.2 klein', { title: 'Vines cut', n: 1 })).toBe(
      'FLUX.2 klein · on Vines cut take 1',
    )
    expect(onTopTake('FLUX.2 klein', null)).toBe('FLUX.2 klein · on the image’s take')
  })
  it('says why a chosen take is set aside', () => {
    expect(onTopStale({ title: 'Vines cut', n: 1 }, 'Vines cut')).toBe(
      'Painted on take 1 of Vines cut, so the game does not show it now. Make a new one here.',
    )
    expect(onTopStale(null, 'Vines cut')).toBe(
      'Painted on the image’s take before the game asked for it on top of Vines cut, so the game does not show it now. Make a new one here.',
    )
  })
  it('asks before the patch underneath changes its take', () => {
    const q = { of: 'Vines cut', from: 1, to: 3, leaving: ['Stick'] }
    expect(onTopQuestionLead({ kind: 'choose', n: 3 }, q)).toBe(
      '1 chosen patch was painted on take 1 of Vines cut: Stick. The game will stop showing it until you make a new one.',
    )
    expect(onTopQuestionLead({ kind: 'choose', n: 3 }, { ...q, leaving: ['Stick', 'Snare'] })).toBe(
      '2 chosen patches were painted on take 1 of Vines cut: Stick and Snare. The game will stop showing them until you make new ones.',
    )
    expect(onTopQuestionDim(q)).toBe('Choosing take 1 again brings it back.')
    expect(onTopQuestionDim({ ...q, leaving: ['Stick', 'Snare'] })).toBe(
      'Choosing take 1 again brings them all back.',
    )
    expect(onTopQuestionLead({ kind: 'drop', n: 1 }, q)).toBe(
      '1 chosen patch was painted on take 1 of Vines cut: Stick. After this it cannot be brought back; only a new one can be made.',
    )
  })
  it('names the mistakes in the act’s row, joined by semicolons', () => {
    expect(
      onTopActLine([
        { title: 'Stick', rowText: 'the game asks for it on top of “rope”' },
        { title: 'Snare', rowText: 'the game asks for it on top of itself' },
      ]),
    ).toBe(
      'cannot be made: Stick (the game asks for it on top of “rope”); Snare (the game asks for it on top of itself)',
    )
    expect(joinTitles(['A', 'B', 'C'])).toBe('A, B and C')
  })
})

describe('chosenTakeLabel', () => {
  it('is the plain label with nothing underneath', () => {
    expect(chosenTakeLabel([])).toBe('The chosen take of the image')
  })
  it('names the chosen takes laid in underneath', () => {
    expect(chosenTakeLabel([{ title: 'Vines cut', n: 1 }])).toBe(
      'The chosen take of the image, with Vines cut’s chosen take laid in',
    )
    expect(
      chosenTakeLabel([
        { title: 'Vines cut', n: 1 },
        { title: 'Moss', n: 2 },
      ]),
    ).toBe(
      'The chosen take of the image, with Vines cut’s chosen take and Moss’s chosen take laid in',
    )
  })
})

describe('the green line after a fine-tune is chosen', () => {
  it('says what was counted as up to date, as the top notice names it', () => {
    expect(acceptedLineText(['the style'], 6, 'Act 2')).toBe(
      'Counted as up to date with the image style, which changed after Take 6 was made.',
    )
    expect(
      acceptedLineText(['the words', 'the act style'], 6, 'Act 2', { now: 'Act 2', was: 'Act 1' }),
    ).toBe(
      "Counted as up to date with the words and Act 2's style instead of Act 1's, which changed after Take 6 was made.",
    )
  })
  it('says what Undo accept left out of date', () => {
    expect(leftOutOfDateText(['the style'], 'Act 2')).toBe('Left out of date: the image style.')
  })
  it('says the size needs a new take, and the failures with their reason', () => {
    expect(sizeStillOutText()).toBe(
      'It is still out of date: its size changed, which needs a new take.',
    )
    expect(acceptFailedText('The lock is broken.', ['the style'], 'Act 2')).toEqual({
      why: 'It could not be counted as up to date: The lock is broken.',
      rest: 'It is out of date for the image style; Accept is at the top of the page.',
    })
    expect(undoAcceptFailedText('Nothing was accepted for this take.')).toBe(
      'It could not be put back out of date: Nothing was accepted for this take.',
    )
  })
})
