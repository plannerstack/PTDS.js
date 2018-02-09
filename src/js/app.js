import { queue } from 'd3-queue';
import { json } from 'd3-request';
import dat from 'dat.gui';

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

const createVisualization = (error, data) => {
  const ptds = new PTDS(data, options);

  // If the spiral simulation mode was chosen, add a widget that
  // allows to control the parameters of the simulation
  if (options.mode === 'spiralSimulation') {
    const gui = new dat.GUI();
    const guiOptions = Object.assign({}, options.spiral, { time: '00:00:00' });

    const sliders = [
      gui.add(guiOptions, 'timeMultiplier', 0, 200),
      gui.add(guiOptions, 'paramA', 0, 200),
      gui.add(guiOptions, 'paramB', 0, 200),
    ];

    const timeCallback = (time) => { guiOptions.time = time; };
    let simulationRunning = false;

    // Refresh of the simulation when one of the sliders is changed
    const refreshViz = () => {
      if (simulationRunning) {
        ptds.stopSpiralSimulation();
        ptds.startSpiralSimulation(
          guiOptions.timeMultiplier,
          guiOptions.paramA,
          guiOptions.paramB,
          timeCallback,
        );
      }
    };

    // Attach refresh listener to the finish change event
    sliders.forEach(slider => slider.onFinishChange(refreshViz));

    // Start/stop the spiral simulation
    const startStopViz = () => {
      if (simulationRunning) {
        ptds.stopSpiralSimulation();
        simulationRunning = false;
      } else {
        ptds.startSpiralSimulation(
          guiOptions.timeMultiplier,
          guiOptions.paramA,
          guiOptions.paramB,
          timeCallback,
        );
        simulationRunning = true;
      }
    };
    Object.assign(guiOptions, { 'start/stop': startStopViz });

    gui.add(guiOptions, 'time').listen();
    gui.add(guiOptions, 'start/stop');
  }
};

// Load JSON data asynchronously
d3.queue()
  .defer(d3.json, 'data/test.json')
  .await(createVisualization);
