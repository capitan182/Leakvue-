/* Leakvue — pick lists and defaults. Edit these to match how your office works. */
(function () {
  'use strict';
  const LV = window.LV;

  const DEFAULT_DISCLAIMER =
    'Leak detection was performed using non-invasive equipment and methods. Findings reflect the ' +
    'conditions observed at the time of service. Leak locations are pinpointed as accurately as site ' +
    'conditions allow (slab thickness, soil, flooring, background noise and access can affect accuracy). ' +
    'Areas that were not accessible were not inspected. This report does not include repairs unless ' +
    'stated otherwise, and additional leaks may exist or develop after this inspection.';

  LV.catalog = {
    statuses: [
      { id: 'scheduled', label: 'Scheduled' },
      { id: 'in_progress', label: 'In progress' },
      { id: 'completed', label: 'Completed' },
    ],

    serviceTypes: [
      'Slab leak',
      'Water line leak',
      'Main service line',
      'Pool / spa leak',
      'Sewer / drain',
      'Irrigation leak',
      'Gas line leak',
      'Fire line leak',
      'Shower pan / tub',
      'Roof / moisture intrusion',
      'High water bill',
      'Commercial / industrial',
      'Other',
    ],

    propertyTypes: [
      'Single-family home',
      'Condo / townhome',
      'Multi-family',
      'Commercial',
      'HOA / common area',
      'Pool / spa',
      'Other',
    ],

    methods: [
      { id: 'acoustic', label: 'Electronic acoustic listening' },
      { id: 'thermal', label: 'Thermal imaging' },
      { id: 'pressure', label: 'Line pressure testing' },
      { id: 'isolation', label: 'Line isolation' },
      { id: 'meter', label: 'Water meter / flow test' },
      { id: 'tracer', label: 'Tracer gas' },
      { id: 'camera', label: 'Video camera inspection' },
      { id: 'moisture', label: 'Moisture meter' },
      { id: 'dye', label: 'Dye test' },
      { id: 'bucket', label: 'Bucket / evaporation test' },
      { id: 'visual', label: 'Visual inspection' },
    ],

    systems: [
      'Cold water supply',
      'Hot water supply',
      'Main service line',
      'Sewer / drain',
      'Pool / spa plumbing',
      'Pool / spa shell',
      'Irrigation',
      'Gas',
      'Fire line',
      'Roof / building envelope',
      'HVAC / condensate',
      'Fixture / appliance',
      'Other',
    ],

    severities: [
      { id: 'minor', label: 'Minor' },
      { id: 'moderate', label: 'Moderate' },
      { id: 'severe', label: 'Severe' },
    ],

    results: [
      { id: 'leak_found', label: 'Leak located', tone: 'danger' },
      { id: 'no_leak', label: 'No leak detected', tone: 'ok' },
      { id: 'further', label: 'Further testing recommended', tone: 'warn' },
    ],

    testOutcomes: [
      { id: '', label: '—' },
      { id: 'ok', label: 'No leak indicated' },
      { id: 'leak', label: 'Leak indicated' },
    ],

    testSuggestions: [
      'Water meter leak indicator',
      'Meter reading (start)',
      'Meter reading (end)',
      'Static water pressure',
      'Main line pressure test',
      'Cold side pressure test',
      'Hot side pressure test',
      'Water heater isolation',
      'Toilet dye test',
      'Irrigation isolation',
      'Pool bucket test',
      'Pool dye test',
      'Pool pressure test (return lines)',
      'Pool pressure test (suction lines)',
      'Sewer camera inspection',
      'Moisture readings',
      'Surface temperature (thermal)',
    ],

    defaultDisclaimer: DEFAULT_DISCLAIMER,

    defaultSettings() {
      return {
        companyName: 'American Leak Detection',
        companyTagline: '',
        phone: '',
        email: '',
        website: '',
        address: '',
        license: '',
        logo: '',
        jobPrefix: 'LV',
        jobSeq: 0,
        defaultTechnician: '',
        disclaimer: DEFAULT_DISCLAIMER,
      };
    },

    label(list, id) {
      const hit = list.find((x) => x.id === id);
      return hit ? hit.label : '';
    },
  };
})();
