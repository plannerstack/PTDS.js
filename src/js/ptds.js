import { select } from 'd3-selection';
import { zoom } from 'd3-zoom';
import { timeFormat } from 'd3-time-format';
import { timer } from 'd3-timer';
import dat from 'dat.gui';

import PTDataset from './ptdataset';
import TimeUtils from './timeutils';
import InteractiveMap from './viz_components/interactivemap';
import MareyDiagram from './viz_components/mareydiagram';

const d3 = Object.assign({}, {
  select,
  zoom,
  timeFormat,
  timer,
});

/**
 * Main class
 */
export default class PTDS {
  constructor(inputData, options) {
    this.data = new PTDataset(inputData);
    this.options = options;

    if (options.mode === 'spiralSimulation') { this.createSimulationWidget(); }

    this.createVisualizations();
  }

  /**
   * Create the SVG elements
   */
  createSVGObjects() {
    /* eslint global-require: "off" */
    // Get browser dimensions
    // The correction factors are needed because the actual size
    // available is less than the one returned by the browser due to scrollbars
    // and other elements that take up space.
    const windowWidth = window.innerWidth - 20;
    const windowHeight = window.innerHeight - 10;

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
    };

    if (this.options.mode === 'dual') {
      // Inner and outer dimensions of the Marey diagram and the map
      this.dims = {
        marey: {
          outerWidth: windowWidth * this.options.dual.verticalSplitPercentage,
          outerHeight: windowHeight * this.options.dual.mareyHeightMultiplier,
        },
        map: {
          outerWidth: windowWidth * (1 - this.options.dual.verticalSplitPercentage),
          outerHeight: windowHeight,
          innerHeight: windowHeight - margins.map.top - margins.map.bottom,
        },
      };
      this.dims.marey.innerWidth = this.dims.marey.outerWidth - margins.marey.left -
                                   margins.marey.right;
      this.dims.marey.innerHeight = this.dims.marey.outerHeight - margins.marey.top -
                                    margins.marey.bottom;
      this.dims.map.innerWidth = this.dims.map.outerWidth - margins.map.left - margins.map.right;

      // Create main marey SVG element applying the margins
      this.mareySVG = d3.select('div.main').append('div')
        .attr('id', 'marey-container')
        .style('height', `${windowHeight}px`)
        .append('svg')
        .attr('id', 'marey')
        .attr('width', this.dims.marey.outerWidth)
        .attr('height', this.dims.marey.outerHeight)
        .call(d3.zoom()
          .scaleExtent([1, 20])
          .translateExtent([[0, 0], [this.dims.marey.innerWidth, this.dims.marey.innerHeight]])
          .on('zoom', () => this.marey.zoomed(require('d3-selection').event.transform)))
        .append('g')
        .attr('transform', `translate(${margins.marey.left},${margins.marey.top})`);
    } else {
      this.dims = {
        map: {
          outerWidth: windowWidth,
          outerHeight: windowHeight,
          innerWidth: windowWidth - margins.map.left - margins.map.right,
          innerHeight: windowHeight - margins.map.top - margins.map.bottom,
        },
      };
    }

    // Create main map SVG element applying the margins
    this.mapSVG = d3.select('div.main').append('div')
      .attr('id', 'map-container')
      .append('svg')
      .attr('id', 'map')
      .attr('width', this.dims.map.outerWidth)
      .attr('height', this.dims.map.outerHeight)
      .call(d3.zoom()
        .scaleExtent([1, 15])
        .translateExtent([[0, 0], [this.dims.map.innerWidth, this.dims.map.innerHeight]])
        .on('zoom', () =>
          this.mapSVG.attr('transform', require('d3-selection').event.transform)))
      .append('g')
      .attr('transform', `translate(${margins.map.left},${margins.map.top})`);
  }

  /**
   * Add the dat.GUI widget in the top right of the screen
   * to control the parameters of the simulation
   */
  createSimulationWidget() {
    const gui = new dat.GUI();
    const guiOptions = Object.assign({}, this.options.spiral, { time: ' ' });

    const sliders = [
      gui.add(guiOptions, 'timeMultiplier', 0, 500),
      gui.add(guiOptions, 'paramA', 0, 200),
      gui.add(guiOptions, 'paramB', 0, 200),
    ];

    const timeCallback = (time) => { guiOptions.time = time; };
    let simulationRunning = false;

    // Refresh of the simulation when one of the sliders is changed
    const refreshViz = () => {
      if (simulationRunning) {
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
      if (simulationRunning) {
        this.stopSpiralSimulation();
        simulationRunning = false;
      } else {
        this.startSpiralSimulation(
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

  /**
   * Create the Marey and/or Map visualization(s) invoking the respective constructor(s)
   */
  createVisualizations() {
    // First, create the SVG objects
    this.createSVGObjects();

    // Create the map
    this.map = new InteractiveMap(
      this.getBaseMapData(),
      this.mapSVG,
      this.dims.map,
      this.options,
    );

    // If we are in "dual" mode, draw the Marey diagram of the chosen journey pattern
    if (this.options.mode === 'dual') {
      // Callback that updates the map when the timeline is moved in the Marey diagram
      const timelineChangeCallback = (time) => {
        this.map.updateData({
          trips: this.getTripsAtTime(
            TimeUtils.HHMMSStoSeconds(time),
            trip => this.options.dual.journeyPatterns.includes(trip.journeyPattern.code),
          ),
        });
        this.map.drawTrips();
      };

      // Creation of the Marey diagram
      this.marey = new MareyDiagram(
        this.getMareyData(),
        this.mareySVG,
        this.dims.marey,
        this.options,
        timelineChangeCallback,
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
      for (const journeyPatternRef of this.options.dual.journeyPatterns) {
        for (const stop of this.data.journeyPatterns[journeyPatternRef].stops) {
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
    const stopAreas = this.options.showStopAreas ?
      Object.values(this.data.stopAreas)
        .filter(stopArea => stopArea.stops.some(stop => validStops.includes(stop))) :
      [];

    // Get the links that have both stops in the valid stop list
    const links = this.options.showLinks ?
      Object.values(this.data.stopsLinks)
        .filter(stopsLink =>
          validStops.includes(stopsLink.stop1) && validStops.includes(stopsLink.stop2)) :
      [];

    return { stops: validStops, stopAreas, links, trips: [] };
  }

  /**
   * Get the data needed to draw the Marey diagram
   * @return {{
   *   trips: Array.<{
   *     code: string,
   *     schedule: Array.<{time: string, distance: number}>,
   *     vehicles: Array.<{
   *       vehichleNumber: number,
   *       positions: {time: number, distance: number, status: string, prognosed: boolean}
   *     }>
   *   }>,
   *   stopsDistances: Array.<{stop: Stop, distance: number}>
   * }} - Data for the Marey diagram
   */
  getMareyData() {
    // TODO: support multiple journey patterns
    const journeyPatternCode = this.options.dual.journeyPatterns[0];
    const journeyPattern = this.data.journeyPatterns[journeyPatternCode];

    // Trips that belong to the chosen journey pattern(s)
    const trips = journeyPattern.vehicleJourneys;

    // Create trips list with essential information for the Marey diagram
    const tripsProcessed = trips.map(trip => ({
      code: trip.code,
      schedule: trip.staticSchedule.map(({ time, distance }) => ({
        time: TimeUtils.secondsToHHMMSS(time),
        distance,
      })),
      vehicles: trip.getVehiclePositions(),
    }));

    return { trips: tripsProcessed, stopsDistances: journeyPattern.stopsDistances };
  }

  /**
   * Get all the trips active at a given time. It supports a filter
   * @param  {number} time - Time in seconds since noon minus 12h
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
   * till the end of the day, then go back to the start time and loop.
   * Every paramA seconds the vehicles are sent back in time by paramB seconds.
   * @param  {Number} timeMultiplier - Conversion factor between real and visualization time
   * @param  {Number} paramA - See above
   * @param  {Number} paramB - See above
   * @param  {Function} timeCallback - Callback to call when time is updated
   */
  startSpiralSimulation(timeMultiplier, paramA, paramB, timeCallback) {
    const currentTimeInHHMMSS = d3.timeFormat('%H:%M:%S')(new Date());
    const startTimeViz = TimeUtils.HHMMSStoSeconds(currentTimeInHHMMSS);

    // Store the reference to the timer in the current instance so that
    // we can stop it later
    this.spiralTimer = d3.timer((elapsedMilliseconds) => {
      // Compute elapsed seconds in the visualization
      const elapsedSecondsInViz = (elapsedMilliseconds * timeMultiplier) / 1000;
      // Compute 'spiral' negative offset.
      const spiralOffset = Math.floor(elapsedSecondsInViz / paramA) * paramB;

      // When the time of the visualization reaches the end of the day,
      // go back to the initial start time
      const vizTime = startTimeViz +
        ((elapsedSecondsInViz - spiralOffset) % (115200 - startTimeViz));

      timeCallback(TimeUtils.secondsToHHMMSS(vizTime));

      this.map.updateData({ trips: this.getTripsAtTime(vizTime) });
      this.map.drawTrips();
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
