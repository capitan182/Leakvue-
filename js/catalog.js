/* Leakvue — pick lists, wording and defaults. Edit here to match how your techs talk. */
(function () {
  'use strict';
  const LV = window.LV;

  const DEFAULT_DISCLAIMER =
    'LeakVue measures changes in the water surface to a fraction of an inch. Results reflect the ' +
    'conditions during each scan (weather, wind, swimmers, rain and auto-fill can all affect them). ' +
    'Gallon figures are estimates based on the pool\'s measured surface area and a typical evaporation ' +
    'rate for the day of the test.';

  LV.catalog = {
    bodies: ['Pool', 'Spa', 'Pool + spa', 'Fountain', 'Pond / water feature'],

    shapes: [
      { id: 'rectangle', label: 'Rectangle' },
      { id: 'oval', label: 'Oval' },
      { id: 'round', label: 'Round' },
      { id: 'kidney', label: 'Kidney / freeform' },
      { id: 'area', label: 'I know the surface area' },
    ],

    pumps: [
      { id: 'on', label: 'Pump ON', short: 'ON' },
      { id: 'off', label: 'Pump OFF', short: 'OFF' },
    ],

    isolationSuggestions: [
      'Main drain',
      'Skimmer line',
      'Return lines',
      'Spa return lines',
      'Light niche',
      'Cleaner line',
      'Waterfall / feature line',
      'Spillover',
      'Equipment pad',
      'Pool shell (below skimmer)',
    ],

    /* What the pump ON vs OFF comparison usually points to, in homeowner language. */
    patterns: {
      pressure: {
        label: 'Pressure side (return lines / equipment)',
        title: 'It leaks more when the pump is running',
        body: 'When the pump runs, it pushes water back to the pool through the return lines under pressure. ' +
              'Losing more water with the pump on points to a leak in that pressurized plumbing or at the equipment.',
      },
      suction: {
        label: 'Suction side (skimmer / main drain lines)',
        title: 'It leaks more when the pump is off',
        body: 'While the pump runs, the skimmer and main drain lines pull water toward the pump, which can hold water in. ' +
              'When the pump is off, water can escape through a break in those lines. Losing more with the pump off points to the suction-side plumbing.',
      },
      structure: {
        label: 'Pool structure (shell, light, fittings)',
        title: 'It leaks about the same with the pump on or off',
        body: 'Because the pump makes little difference, the leak is most likely in the pool itself rather than the plumbing — ' +
              'for example a light, a fitting, the skimmer, or a crack in the shell.',
      },
      none: {
        label: 'No leak (normal evaporation)',
        title: 'Water loss is within normal evaporation',
        body: 'The pool lost about as much water as normal evaporation for the conditions. We did not measure a leak during this test.',
      },
      single: {
        label: 'Leak found (one pump setting tested)',
        title: 'The pool is losing more than evaporation',
        body: 'The pool is losing more water than evaporation alone explains, which means there is a leak.',
      },
    },

    /* The homeowner report, in the plainest words we can find. No jargon, one idea per line. */
    plain: {
      // Where the leak most likely is, from the pump ON / OFF comparison.
      where: {
        pressure: {
          spot: 'The pipes that carry water back into your pool, or the pool equipment',
          why: 'It leaked more while the pump was running.',
        },
        suction: {
          spot: 'The pipes that pull water out of your pool (from the skimmer or the main drain)',
          why: 'It leaked more while the pump was off.',
        },
        structure: {
          spot: 'The pool itself: a light, a fitting, the skimmer, or a crack',
          why: 'Turning the pump on or off made no difference.',
        },
      },
      // What each part a tech can isolate is, for someone who has never looked at their plumbing.
      parts: {
        'main drain': 'the drain at the bottom of your pool and its pipe',
        'skimmer line': 'the pipe from the skimmer, the box at the edge of the pool that catches leaves',
        'return lines': 'the pipes that carry water back into your pool',
        'spa return lines': 'the pipes that carry water back into your spa',
        'light niche': 'the housing around your pool light',
        'cleaner line': 'the pipe that runs your pool cleaner',
        'waterfall / feature line': 'the pipe that feeds your waterfall or water feature',
        'spillover': 'where the spa spills over into the pool',
        'equipment pad': 'the pump, filter and heater area',
        'pool shell (below skimmer)': 'the pool itself, below the skimmer',
      },
      // What to call it in a sentence, from "What are we testing?"
      things: { 'Pool': 'pool', 'Spa': 'spa', 'Pool + spa': 'pool', 'Fountain': 'fountain', 'Pond / water feature': 'water feature' },
      noLeak: 'Good news: we did not find a leak. Your {thing} is only losing what the sun and wind normally take.',
      nextDefault: 'Your technician will go over the next steps with you.',
    },

    diagnosisOptions: [
      { id: '', label: 'Automatic (from the pump ON / OFF scans)' },
      { id: 'pressure', label: 'Pressure side (return lines / equipment)' },
      { id: 'suction', label: 'Suction side (skimmer / main drain lines)' },
      { id: 'structure', label: 'Pool structure (shell, light, fittings)' },
      { id: 'none', label: 'No leak (normal evaporation)' },
      { id: 'hide', label: 'Don’t show a diagnosis' },
    ],

    defaultDisclaimer: DEFAULT_DISCLAIMER,

    defaultSettings() {
      return {
        companyName: 'American Leak Detection',
        companyTagline: '',
        phone: '',
        email: '',
        website: '',
        license: '',
        logo: '',
        jobPrefix: 'LV',
        jobSeq: 0,
        defaultTechnician: '',
        scanMinutes: 15,
        evaporation: 0.25,
        margin: 0.1,
        waterCost: '',
        disclaimer: DEFAULT_DISCLAIMER,
      };
    },

    label(list, id) {
      const hit = list.find((x) => x.id === id);
      return hit ? hit.label : '';
    },
  };
})();
