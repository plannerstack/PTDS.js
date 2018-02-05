import * as d3 from 'd3';
import dat from 'dat.gui';
import PTDS from './ptds';

// Load JSON data asynchronously
d3.queue()
  .defer(d3.json, 'data/test.json')
  .await((error, data) => {
    const ptdsOptions = {
      stopRadius: 1,
      stopAreaRadius: 1,
      tripRadius: 3,
      showStops: true,
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
        mareyHeightMultiplier: 3,
        journeyPattern: 'HTM:1:363',
      },
    };

    const ptds = new PTDS(data, ptdsOptions);

    // If the spiral simulation mode was chosen, add a widget that
    // allows to control the parameters of the simulation
    if (ptdsOptions.mode === 'spiralSimulation') {
      let simulationRunning = true;
      const gui = new dat.GUI();
      const guiOptions = Object.assign({
        'start/stop': () => {
          if (simulationRunning) {
            ptds.stopSpiralSimulation();
            simulationRunning = false;
          } else {
            ptds.startSpiralSimulation(
              guiOptions.timeMultiplier,
              guiOptions.paramA,
              guiOptions.paramB,
            );
            simulationRunning = true;
          }
        },
      }, ptdsOptions.spiral);

      const sliders = [
        gui.add(guiOptions, 'timeMultiplier', 0, 200),
        gui.add(guiOptions, 'paramA', 0, 200),
        gui.add(guiOptions, 'paramB', 0, 200),
      ];

      // Update the simulation as soon as one of the sliders of
      // the parameters is changed
      sliders.forEach(slider => slider.onFinishChange(() => {
        ptds.stopSpiralSimulation();
        ptds.startSpiralSimulation(
          guiOptions.timeMultiplier,
          guiOptions.paramA,
          guiOptions.paramB,
        );
      }));

      gui.add(guiOptions, 'start/stop');
    }
  });
