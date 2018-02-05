import * as d3 from 'd3';
import PTDS from './ptds';

// Load JSON data asynchronously
d3.queue()
  .defer(d3.json, 'data/test.json')
  .await((error, data) => {
    /* eslint-disable no-unused-vars */
    const ptds = new PTDS(data, {
      stopRadius: 1,
      stopAreaRadius: 1,
      tripRadius: 4,
      showStops: false,
      showStopAreas: true,
      showLinks: true,
      verticalSplitPercentage: (Math.sqrt(5) - 1) / 2,
      mareyHeightMultiplier: 3,
    });
  });
