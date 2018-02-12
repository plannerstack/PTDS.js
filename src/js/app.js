import { queue } from 'd3-queue';
import { json } from 'd3-request';
import * as log from 'loglevel';

import PTDS from './ptds';

log.enableAll();

const d3 = Object.assign({}, {
  queue,
  json,
});

// Gets parameter from URL
const getURLParameter = name =>
  /* eslint no-restricted-globals: "off" */
  decodeURIComponent((new RegExp(`[?|&]${name}=([^&;]+?)(&|#|;|$)`).exec(location.search) ||
    [null, ''])[1].replace(/\+/g, '%20')) || null;

// Get the mode of the visualization from the URL parameter
let mode = getURLParameter('mode');
if (mode === null) {
  do {
    /* eslint no-alert: "off" */
    const defaultMode = 'dual';
    mode = prompt(
      'You have to choose a mode. It has to be either "dual" or "spiralSimulation":',
      defaultMode,
    );
  } while (mode !== 'dual' && mode !== 'spiralSimulation');
}

const options = {
  stopRadius: 1,
  stopAreaRadius: 1,
  tripRadius: 3,
  showStops: false,
  showStopAreas: true,
  showLinks: true,
  // mode can be either 'dual' or 'spiralSimulation'
  // dual = marey + linked map, spiralSimulation = spiral simulation
  mode,
  // spiralSimulation specific options
  spiral: {
    timeMultiplier: 30,
    paramA: 30,
    paramB: 15,
  },
  // dual specific options
  dual: {
    verticalSplitPercentage: (Math.sqrt(5) - 1) / 2,
    mareyHeightMultiplier: 5,
    journeyPattern: 'HTM:16:231',
  },
};

// Load JSON data asynchronously
/* eslint no-new: "off" */
d3.queue()
  .defer(d3.json, 'data/singleLine.json')
  .await((error, data) => { new PTDS(data, options); });
