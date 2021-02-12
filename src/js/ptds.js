import { select } from 'd3-selection';
import { timeFormat } from 'd3-time-format';
import { timer, interval } from 'd3-timer';
import dat from 'dat.gui';

import PTDataset from './ptdataset';
import InteractiveMap from './viz_components/interactivemap';
import MareyDiagram from './viz_components/mareydiagram';

const d3 = Object.assign({}, {
  select,
  timeFormat,
  timer,
  interval,
});

/**
 * Main class
 */
export default class PTDS {
  constructor(inputData, options, markerData) {
    this.marey = null;
    this.options = options;
    this.data = new PTDataset(inputData, this.options.selectedDate, markerData);

    if (this.options.realtime === true && this.data.updateUrl !== undefined) {
      this.dataUpdateTimer = d3.interval(() => {
        if (this.marey !== null) {
          fetch(this.data.updateUrl).then(r => r.json()).then((updateData) => {
            this.data.updateVehicleJourneys(updateData.vehicleJourneys);
          });
          this.marey.update();
        }
      }, 15000, 15000);
    }

    if (['dual', 'marey'].includes(this.options.mode)) {
      this.journeyPatternMix = this.computeJourneyPatternMix();
    } else if (this.options.mode === 'spiralSimulation') {
      this.widgetTimeFormat = d3.timeFormat('%Y-%m-%d %H:%M:%S');
      this.createSimulationWidget();
    }

    this.createVisualizations();
  }

  /**
   * Used in the dual visualization mode, computes the object representing the mix of journey
   * patterns that we are going to visualize.
   * @return {{
   *         referenceJP: JourneyPattern,
   *         otherJPs: {
   *           journeyPattern: JourneyPattern,
   *           sharedSequences: {
   *              referenceSequences: Array.<Array.<number>>,
   *              otherSequences: Array.<Array.<number>>
   *            }
   *         }
   * }} - Object representing the mix of journey patterns to display
   */
  computeJourneyPatternMix() {
    let maxNstops = -1;
    let maxNstopsJP;

    // Find the longest journey pattern with the given line and direction (most stops)
    for (const journeyPattern of Object.values(this.data.journeyPatterns)) {
      if (journeyPattern.line.code === this.options.line
          && journeyPattern.direction === this.options.direction
          && journeyPattern.stops.length > maxNstops) {
        maxNstops = journeyPattern.stops.length;
        maxNstopsJP = journeyPattern;
      }
    }

    const journeyPatternMix = {
      referenceJP: maxNstopsJP,
      otherJPs: [],
    };

    // Compute the shared sequences between the longest journey pattern and all the other ones
    for (const journeyPattern of Object.values(this.data.journeyPatterns)) {
      if (journeyPattern.code !== maxNstopsJP.code
        && (this.options.overlap || journeyPattern.line.code === maxNstopsJP.line.code)) {
        const sharedSequences = maxNstopsJP.sharedSequences(journeyPattern);
        if (sharedSequences) journeyPatternMix.otherJPs.push({ journeyPattern, sharedSequences });
      }
    }

    return journeyPatternMix;
  }

  /**
   * Create the SVG elements
   */
  createSVGObjects() {
    // Get browser dimensions
    // The correction factors are needed because the actual size
    // available is less than the one returned by the browser due to scrollbars
    // and other elements that take up space.
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    // D3 margin convention https://bl.ocks.org/mbostock/3019563
    const margins = {
      marey: {
        top: 80,
        right: 50,
        bottom: 20,
        left: 50,
      },
      map: {
        top: 20,
        right: 20,
        bottom: 20,
        left: 20,
      },
      mareyScroll: {},
      mareyStopSelection: {},
    };

    if (['dual', 'marey'].includes(this.options.mode)) {
      const dual = this.options.mode === 'dual';

      this.dims = { marey: null, map: null };

      {
        const outerWidth = dual
          ? windowWidth * this.options.dual.verticalSplitPercentage
          : windowWidth;
        const outerHeight = windowHeight;
        const innerHeight = outerHeight - margins.marey.top - margins.marey.bottom;
        this.dims.marey = { outerWidth, outerHeight, innerHeight };
      }

      this.dims.mareyScroll = {
        width: 70,
        height: this.dims.marey.innerHeight,
      };

      this.dims.mareyStopSelection = {
        width: 170,
        height: this.dims.marey.innerHeight,
      };

      this.dims.marey.innerWidth = this.dims.marey.outerWidth - margins.marey.left
                                   - margins.marey.right - this.dims.mareyScroll.width
                                   - this.dims.mareyStopSelection.width - 30;
      margins.mareyLabel = {
        left: margins.marey.left + this.dims.marey.innerWidth + 50,
        top: 50,
      };
      margins.mareyScroll = {
        left: margins.marey.left + this.dims.marey.innerWidth + 100,
        top: margins.marey.top,
      };
      margins.mareyStopSelection = {
        left: margins.mareyScroll.left + this.dims.mareyScroll.width,
        top: margins.marey.top,
      };

      if (dual) {
        const outerWidth = windowWidth * (1 - this.options.dual.verticalSplitPercentage);
        const outerHeight = windowHeight;
        const innerWidth = outerWidth - margins.map.left - margins.map.right;
        const innerHeight = windowHeight - margins.map.top - margins.map.bottom;

        this.dims.map = { outerWidth, outerHeight, innerHeight, innerWidth };
      }

      // Create main marey SVG element applying the margins
      const mareySVG = d3.select('div.main')
        .append('div')
        .attr('id', 'marey-container')
        .append('svg')
        .attr('id', 'marey')
        .attr('width', this.dims.marey.outerWidth)
        .attr('height', this.dims.marey.outerHeight);

      const label = mareySVG.append('g')
        .attr('transform', `translate(${margins.mareyLabel.left}, ${margins.mareyLabel.top})`);

      label.append('text')
        .text(`${this.options.line} - ${this.options.direction}`)
        .attr('font-size', '16')
        .attr('font-weight', 'bold');

      label.append('text')
        .attr('transform', 'translate(100, 0)')
        .text('reverse')
        .on('click', () => {
          d3.select('#map').remove();
          d3.select('#marey-container').remove();
          this.options.trip = null;
          this.options.direction = (this.options.direction === 1 ? 2 : 1);
          this.journeyPatternMix = this.computeJourneyPatternMix();
          this.createVisualizations();
        });

      label.append('text')
        .attr('transform', 'translate(150, 0)')
        .text('realtime')
        .on('click', () => {
          d3.select('#map').remove();
          d3.select('#marey-container').remove();
          this.options.realtime = !this.options.realtime;
          this.createVisualizations();
        });

      // Create transformed groups and store their reference
      this.mareySVGgroups = {
        label,
        diagram: mareySVG.append('g')
          .attr('transform', `translate(${margins.marey.left},${margins.marey.top})`),
        scroll: mareySVG.append('g')
          .attr('class', 'marey-scroll')
          .attr('transform', `translate(${margins.mareyScroll.left},${margins.mareyScroll.top})`),
        stopSelection: mareySVG.append('g')
          .attr('class', 'marey-stop-selection')
          .attr(
            'transform',
            `translate(${margins.mareyStopSelection.left},${margins.mareyStopSelection.top})`,
          ),
      };
    } else {
      // Fullscreen simulation
      this.dims = {
        map: {
          outerWidth: windowWidth,
          outerHeight: windowHeight,
          innerWidth: windowWidth - margins.map.left - margins.map.right,
          innerHeight: windowHeight - margins.map.top - margins.map.bottom,
        },
      };
    }

    // If we're either in simulation or dual mode, create the map SVG element
    if (['dual', 'spiralSimulation'].includes(this.options.mode)) {
      this.mapSVG = d3.select('div.main').append('div')
        .attr('id', 'map-container')
        .append('svg')
        .attr('id', 'map')
        .attr('width', this.dims.map.outerWidth)
        .attr('height', this.dims.map.outerHeight)
        .append('g')
        .attr('transform', `translate(${margins.map.left},${margins.map.top})`);
    }
  }

  /**
   * Add the dat.GUI widget in the top right of the screen
   * to control the parameters of the simulation
   */
  createSimulationWidget() {
    const gui = new dat.GUI();
    gui.domElement.id = 'gui';
    const guiOptions = Object.assign({}, this.options.spiral, {
      time: this.widgetTimeFormat(this.data.earliestTime),
    });

    const sliders = [
      gui.add(guiOptions, 'timeMultiplier', 0, 500),
      gui.add(guiOptions, 'paramA', 1, 200),
      gui.add(guiOptions, 'paramB', 0, 200),
    ];

    const timeCallback = (time) => { guiOptions.time = time; };
    this.simulationRunning = false;

    // Refresh of the simulation when one of the sliders is changed
    const refreshViz = () => {
      if (this.simulationRunning) {
        this.stopSpiralSimulation();
        this.startSpiralSimulation(
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
      if (this.simulationRunning) {
        this.stopSpiralSimulation();
        this.simulationRunning = false;
      } else {
        this.startSpiralSimulation(
          guiOptions.timeMultiplier,
          guiOptions.paramA,
          guiOptions.paramB,
          timeCallback,
        );
        this.simulationRunning = true;
      }
    };
    Object.assign(guiOptions, { 'start/stop': startStopViz });

    gui.add(guiOptions, 'time').listen();
    gui.add(guiOptions, 'start/stop');
  }

  /**
   * Create the Marey and/or Map visualization(s) invoking the respective constructor(s)
   */
  createVisualizations() {
    // First, create the SVG objects
    this.createSVGObjects();

    if (this.options.mode !== 'marey') {
      // Create the map
      this.map = new InteractiveMap(
        this.getBaseMapData(),
        this.mapSVG,
        this.dims.map,
        this.options,
      );
    }

    let selectedTrip = null;
    if (this.options.trip !== undefined) {
      selectedTrip = this.data.vehicleJourneys[this.options.trip];
    }

    // If we are in "dual" mode, draw the Marey diagram of the chosen journey pattern
    if (this.options.mode === 'dual') {
      // Callback that updates the map when the timeline is moved in the Marey diagram
      const timelineChangeCallback = (time) => {
        // Extract the codes of all the journey patterns shown (reference + others sharing >1 link)
        const selectedJPcodes = [
          this.journeyPatternMix.referenceJP.code,
          ...this.journeyPatternMix.otherJPs.map(({ journeyPattern }) => journeyPattern.code),
        ];

        this.map.updateData({
          trips: this.getTripsAtTime(
            time,
            // Display on the map only the trips that we're showing in the diagram
            trip => selectedJPcodes.includes(trip.journeyPattern.code),
          ),
        });
        this.map.drawTrips();
      };

      // Creation of the Marey diagram
      this.marey = new MareyDiagram(
        this.journeyPatternMix,
        this.mareySVGgroups,
        this.dims,
        timelineChangeCallback,
        selectedTrip,
        this.options.realtime,
      );
    } else if (this.options.mode === 'marey') {
      // Creation of the Marey diagram
      this.marey = new MareyDiagram(
        this.journeyPatternMix,
        this.mareySVGgroups,
        this.dims,
        null,
        selectedTrip,
        this.options.realtime,
      );
    }
  }

  /**
   * Get the data needed to draw the initial version of the map,
   * including: stops, stop areas and stops links.
   * @return {{
   *   stops: Array.<Stop>,
   *   stopAreas: Array.<StopArea>,
   *   links: Array.<StopsLink>,
   *   trips: Array
   *  }} - Object containing the stops, stopAreas, links and (empty) trips
   */
  getBaseMapData() {
    const validStops = [];
    if (this.options.mode === 'dual') {
      // If we're in dual mode, we're interested only in the data that belongs
      // to the chosen journey pattern(s). To filter the stops, stop areas and stops links
      // we first extract the stops belonging to the chosen journey pattern(s).
      const selectedJourneyPatterns = [
        this.journeyPatternMix.referenceJP,
        ...this.journeyPatternMix.otherJPs.map(({ journeyPattern }) => journeyPattern),
      ];
      for (const journeyPattern of selectedJourneyPatterns) {
        for (const stop of journeyPattern.stops) {
          validStops.push(stop);
        }
      }
    } else {
      // If we're in spiralSimulation mode, we're interested only in the data connected
      // with the journey patterns present in the dataset. So we extract the stops
      // that appear at least in one journey pattern.
      for (const { stops } of Object.values(this.data.journeyPatterns)) {
        for (const stop of stops) {
          validStops.push(stop);
        }
      }
    }

    // We only pass the stop area information to the map visualization
    // if the options state that they have to be shown.
    // We only consider stop areas that have at least one stop belonging to
    // the valid stop codes list.
    const stopAreas = this.options.showStopAreas
      ? Object.values(this.data.stopAreas)
        .filter(stopArea => stopArea.stops.some(stop => validStops.includes(stop)))
      : [];

    // Get the links that have both stops in the valid stop list
    const links = this.options.showLinks
      ? Object.values(this.data.stopsLinks)
        .filter(stopsLink => validStops.includes(stopsLink.stop1)
          && validStops.includes(stopsLink.stop2))
      : [];

    return { stops: validStops, stopAreas, links, trips: [] };
  }

  /**
   * Get all the trips active at a given time. It supports a filter
   * @param  {Date} time - Time
   * @param  {Function} filterFunc - Function applied to a VehicleJourney to filter it
   * @return {Array.<{
   *   code: string,
   *   vehiclePositions: Array.<{
   *     vehicleNumber: number,
   *     position: Point,
   *     distance: number,
   *     status: string,
   *     prognosed: boolean,
   *    }>
   *  }>} - Active trips information
   */
  getTripsAtTime(time, filterFunc = () => true) {
    // Filter all the trips, keeping only those that are active and satisfy the optional filterFunc
    const filteredTrips = Object.values(this.data.vehicleJourneys)
      .filter(trip => trip.isActive(time) && filterFunc(trip));

    return filteredTrips.map(trip => ({
      code: trip.code,
      vehiclePositions: trip.getPositionsAtTime(time, this.data.stopsLinks),
    }));
  }

  /**
   * Start a 'spiral simulation' showing on the map all the trips from the current time of the day
   * till the end of the day.
   * Every paramA seconds the vehicles are sent back in time by paramB seconds.
   * @param  {number} timeMultiplier - Conversion factor between real and visualization time
   * @param  {number} paramA - See above
   * @param  {number} paramB - See above
   * @param  {Function} timeCallback - Callback to call when time is updated
   */
  startSpiralSimulation(timeMultiplier, paramA, paramB, timeCallback) {
    // Start time of the simulation. If it was already started earlier and then stopped,
    // start again from when it was left. Otherwise, start from the current time in the day.
    const startTimeViz = typeof this.lastTime === 'undefined'
      ? this.data.earliestTime
      : this.lastTime.getTime();

    // Store the reference to the timer in the current instance so that
    // we can stop it later
    this.spiralTimer = d3.timer((elapsedMilliseconds) => {
      // Compute elapsed seconds in the visualization
      const elapsedMilliSecondsInViz = elapsedMilliseconds * timeMultiplier;
      // Compute 'spiral' negative offset
      const spiralOffset = Math.floor(elapsedMilliSecondsInViz / (paramA * 1000)) * paramB * 1000;

      // Compute time currently represented in the visualization
      const vizTime = new Date((startTimeViz + elapsedMilliSecondsInViz) - spiralOffset);

      // If we exceeded the last time in the dataset, stop the simulation and
      // set the default time for the next run
      if (vizTime >= this.data.latestTime) {
        this.spiralTimer.stop();
        this.simulationRunning = false;
        this.lastTime = this.data.earliestTime;
        timeCallback(this.widgetTimeFormat(this.data.earliestTime));
      } else {
        this.lastTime = vizTime;
        this.map.updateData({ trips: this.getTripsAtTime(vizTime) });
        this.map.drawTrips();
        timeCallback(this.widgetTimeFormat(vizTime));
      }
    });
  }

  /**
   * Stop the spiral simulation
   */
  stopSpiralSimulation() {
    if (Object.prototype.hasOwnProperty.call(this, 'spiralTimer')) {
      this.spiralTimer.stop();
    }
  }
}
