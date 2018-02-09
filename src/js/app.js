import { queue } from 'd3-queue';
import { json } from 'd3-request';

import PTDS from './ptds';

const d3 = Object.assign({}, {
  queue,
  json,
});

const options = {
  stopRadius: 1,
  stopAreaRadius: 1,
  tripRadius: 3,
  showStops: false,
  showStopAreas: true,
  showLinks: true,
  // mode can be either 'dual' or 'spiralSimulation'
  // dual = marey + linked map, spiralSimulation = spiral simulation
  mode: 'spiralSimulation',
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
    journeyPattern: 'HTM:1:363',
  },
};

// Load JSON data asynchronously
/* eslint no-new: "off" */
d3.queue()
  .defer(d3.json, 'data/test.json')
  .await((error, data) => { new PTDS(data, options); });
