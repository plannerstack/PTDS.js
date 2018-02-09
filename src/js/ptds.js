import { select } from 'd3-selection';
import { zoom } from 'd3-zoom';
import { timeFormat } from 'd3-time-format';
import { timer } from 'd3-timer';
import dat from 'dat.gui';

import Point from './point';
import Segment from './segment';
import TimeUtils from './timeutils';
import InteractiveMap from './interactivemap';
import MareyDiagram from './mareydiagram';

const d3 = Object.assign({}, {
  select,
  zoom,
  timeFormat,
  timer,
  // very ugly hack to solve a problem that d3 and webpack have
  // https://github.com/d3/d3/issues/2733
  /* eslint-disable */
  event: (() => require('d3-selection').event).bind(this),
  /* eslint-enable */
});

/**
 * Main class
 */
export default class PTDS {
  constructor(inputData, options) {
    this.data = inputData;
    this.options = options;

    this._createSVGObjects();
    if (options.mode === 'spiralSimulation') { this._createSimulationWidget(); }
    this._computeStopAreasAggregation();
    this._computeProjectNetwork();

    this.createVisualizations();
  }

  /**
   * Create the SVG elements
   */
  _createSVGObjects() {
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
        .on('zoom', () => this.mapSVG.attr('transform', d3.event().transform)))
      .append('g')
      .attr('transform', `translate(${margins.map.left},${margins.map.top})`);
  }

  /**
   * Add the dat.GUI widget in the top right of the screen
   * to control the parameters of the simulation
   */
  _createSimulationWidget() {
    const gui = new dat.GUI();
    const guiOptions = Object.assign({}, this.options.spiral, { time: ' ' });

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
   * Computes the aggregation of stops into stop areas
   */
  _computeStopAreasAggregation() {
    // Aggregate stops into stop areas
    const stopAreasAggregation = {};
    for (const [stopCode, stopData] of Object.entries(this.data.scheduledStopPoints)) {
      if (Object.prototype.hasOwnProperty.call(stopAreasAggregation, stopData.area)) {
        stopAreasAggregation[stopData.area].stops[stopCode] = new Point(stopData.x, stopData.y);
      } else {
        stopAreasAggregation[stopData.area] = {
          name: stopData.name,
          stops: { [stopCode]: new Point(stopData.x, stopData.y) },
        };
      }
    }

    // Iterate over all the areas to compute coordinates of area as average of
    // the coordinates of the stops
    for (const stopAreaData of Object.values(stopAreasAggregation)) {
      // Compute the centroid of the stop area
      const centroid = Point.centroid(Object.values(stopAreaData.stops));
      stopAreaData.centroid = centroid;
    }

    this.stopAreasAggregation = stopAreasAggregation;
  }

  /**
   * Builds the project network definition, meaning the position in the canvas
   * of the segments representing the links between the stops
   */
  _computeProjectNetwork() {
    const projectNetwork = {};

    // Iterate over all the journey patterns to build the definition
    for (const journeyPatternData of Object.values(this.data.journeyPatterns)) {
      // Get list of stops of current journey pattern
      const stopsList = journeyPatternData.pointsInSequence;

      // Iterate over pairs of stops and add them to the project definition
      for (const index of [...Array(stopsList.length - 1).keys()]) {
        const stopAcode = stopsList[index];
        const stopBcode = stopsList[index + 1];

        // Get coordinates of current pair of stops
        const stopAdata = this.data.scheduledStopPoints[stopAcode];
        const stopBdata = this.data.scheduledStopPoints[stopBcode];

        // Get centroids of stop areas A and B
        const stopAareaCentroid = this.stopAreasAggregation[stopAdata.area].centroid;
        const stopBareaCentroid = this.stopAreasAggregation[stopBdata.area].centroid;

        projectNetwork[`${stopAcode}|${stopBcode}`] = {
          realSegment: new Segment(
            new Point(stopAdata.x, stopAdata.y),
            new Point(stopBdata.x, stopBdata.y),
          ),
          stopAreasSegment: new Segment(stopAareaCentroid, stopBareaCentroid),
        };
      }
    }

    this.projectNetwork = projectNetwork;
  }


  /**
   * Create the Marey and/or Map visualization(s) invoking the respective constructor(s)
   */
  createVisualizations() {
    // Create the map
    this.map = new InteractiveMap(
      this._getBaseMapData(),
      this.mapSVG,
      this.dims.map,
      this.options,
    );

    // If we are in "dual" mode, draw the Marey diagram of the chosen journey pattern
    if (this.options.mode === 'dual') {
      // Callback that updates the map when the timeline is moved in the Marey diagram
      const timelineChangeCallback = (time) => {
        this.map.updateData({
          trips: this._getTripsAtTime(
            TimeUtils.HHMMSStoSeconds(time),
            tripData => tripData.journeyPatternRef === this.options.dual.journeyPattern,
          ),
        });
        this.map._drawTrips();
      };

      // Creation of the Marey diagram
      this.marey = new MareyDiagram(
        this._getMareyData(this.options.dual.journeyPattern),
        this.mareySVG,
        this.dims.marey,
        this.options,
        timelineChangeCallback,
      );
    }
  }

  /**
   * Get the data needed to draw the initial version of the map,
   * including: stops, stopAreas and links.
   * @return {Object} - Object containing the stops, stopAreas, links and (empty) trips
   */
  _getBaseMapData() {
    // We always need to pass to the map visualization the stop information
    // because it is used to compute the mapping from the dutch grid to the canvas
    const stops = Object.entries(this.data.scheduledStopPoints).map(([stopCode, stopData]) =>
      ({ stopCode, position: new Point(stopData.x, stopData.y) }));

    // We only pass the stoparea information to the map visualization
    // if the options state that they have to be shown
    const stopAreas = this.options.showStopAreas ?
      Object.entries(this.stopAreasAggregation).map(([stopAreaCode, stopAreaData]) =>
        ({ stopAreaCode, position: stopAreaData.centroid })) :
      [];

    const links = this.options.showLinks ?
      Object.entries(this.projectNetwork).map(([linkID, linkData]) =>
        ({ linkID, segment: linkData.stopAreasSegment })) :
      [];

    return {
      stops, stopAreas, links, trips: [],
    };
  }

  /**
   * Get the data needed to draw the Marey diagram
   * @param  {String} journeyPatternCode - Jourey pattern code chosen to display
   */
  _getMareyData(journeyPatternCode) {
    // Journey pattern data (stopcodes, distances) of the chosen journey pattern
    const journeyPatternData = this.data.journeyPatterns[journeyPatternCode];

    // Raw trip objects that belong to the chosen journey pattern
    const tripsRaw = this._getFilteredTrips(tripData =>
      tripData.journeyPatternRef === journeyPatternCode);

    // Create trips list with essential information for the Marey diagram, meaning
    // [{ tripCode: 123, tripSchedule: [{ time: 1, distance: 1 }, ...}] }, ...]
    const trips = Object.entries(tripsRaw).map(([tripCode, tripData]) => ({
      tripCode,
      tripSchedule: tripData.times.map((time, index) => ({
        time: TimeUtils.secondsToHHMMSS(time),
        distance: journeyPatternData.distances[index],
      })),
    }));

    // Create stops-distances list for the axis of the Marey diagram
    // [{ stopCode: 1234, distance: 1 }, ...]
    const stopsDistances = journeyPatternData.distances.map((distance, index) => ({
      stopCode: journeyPatternData.pointsInSequence[index],
      distance,
    }));

    return {
      trips,
      stopsDistances,
    };
  }

  /**
   * Given a trip (code) and its position in terms of time and distances,
   * computes if the vehicle is early/ontime/late basing on the schedule
   * @param  {String} tripCode - Code of the trip
   * @param  {Number} time - Time since departure
   * @param  {Number} distance - Distance since departure
   * @return {String} - Status of the vehicle: early/ontime/late or undefined
   */
  _getVehicleStatusComparedToSchedule(tripCode, time, distance) {
    const tripData = this.data.vehicleJourneys[tripCode];
    const journeyPatternCode = tripData.journeyPatternRef;
    const journeyPatternData = this.data.journeyPatterns[journeyPatternCode];

    // Go over all the segments that make up the trip, looking for the segment in which
    // the vehicle is currently in in terms of distance traveled
    for (const index of [...Array(tripData.times.length - 1).keys()]) {
      const timeStopA = tripData.times[index];
      const timeStopB = tripData.times[index + 1];
      const distanceStopA = journeyPatternData.distances[index];
      const distanceStopB = journeyPatternData.distances[index + 1];

      // If the distance traveled by the vehicle is between the start and end distances
      // of the current segment, we can decide its status
      if (distanceStopA <= distance && distanceStopB >= distance) {
        // Compute the theoretical time that the vehicle should have to be on time
        // having traveled the current distance
        const thTime = (((timeStopB - timeStopA) / (distanceStopB - distanceStopA)) *
                        (distance - distanceStopA)) + timeStopA;
        // Compare theoretical time with actual time and decide the status of the vehicle
        if (time < thTime) {
          return 'early';
        } else if (time === thTime) {
          return 'ontime';
        }
        return 'late';
      }
    }

    // It could be that we don't find a segment that includes the position of the
    // vehicle in terms of distance. In that case signal it
    return 'undefined';
  }

  /**
   * Get the distance traveled by a vehicle in its trip along its journeypattern
   * @param  {Object} tripData - Data of a trip
   * @param  {Number} time - Time expressed as seconds since noon minus 12h
   * @return {Number} Current distance traveled by the vehicle in its trip
   */
  _getTripDistanceAtTime(tripData, time) {
    const journeyPatternData = this.data.journeyPatterns[tripData.journeyPatternRef];
    const { distances } = journeyPatternData;

    // Special case handling: when the time asked for is the time of the last stop of the trip.
    // In that case the distance traveled is the distance at which the last stop is located
    if (tripData.times[tripData.times.length - 1] === time) {
      return distances[distances.length - 1];
    }

    // Find out the index corresponding to the latest time passed currently
    let lastTimeIndex = 0;
    for (const index of [...Array(tripData.times.length - 1).keys()]) {
      if (tripData.times[index + 1] > time) {
        lastTimeIndex = index;
        break;
      }
    }

    // Compute percentage of time between previous and next stop by interpolation
    const percentage = (time - tripData.times[lastTimeIndex]) /
                       (tripData.times[lastTimeIndex + 1] - tripData.times[lastTimeIndex]);

    // Use the percentage to compute the actual distance of the vehicle by correspondence
    // to the distance list
    const currentDistance = distances[lastTimeIndex] +
      (percentage * (distances[lastTimeIndex + 1] - distances[lastTimeIndex]));

    // Keep this for realtime positioning later, but will require finding the lastTimeIndex,
    // from the realtime times list.
    // const currentDistance = tripData.distances[lastTimeIndex] +
    //  (percentage * (tripData.distances[lastTimeIndex+1] - tripData.distances[lastTimeIndex]));

    return currentDistance;
  }

  /**
   * Get the position of a vehicle in its trip given the distance from the start
   * of its journey
   * @param  {Object} tripData - Data of a trip
   * @param  {Number} distance - Distance along the trip of the vehicle
   * @return {Point} Point in the map in which the vehicle is found now
   */
  _getTripPositionFromDistance(tripData, distance) {
    const journeyPatternData = this.data.journeyPatterns[tripData.journeyPatternRef];
    const { pointsInSequence } = journeyPatternData;

    // Special case handling: when the distance asked for is the distance
    // at which the last stop is located
    if (journeyPatternData.distances[journeyPatternData.distances.length - 1] === distance) {
      const previousStopCode = pointsInSequence[pointsInSequence.length - 2];
      const nextStopCode = pointsInSequence[pointsInSequence.length - 1];
      const currentSegment = this.projectNetwork[`${previousStopCode}|${nextStopCode}`];

      return currentSegment.stopAreasSegment.getPointByPercentage(1.0);
    }

    // Iterate over the journey pattern to find the previous and the next stop basing on the
    // current distance
    let lastStopIndex = -1;
    for (const index of [...Array(journeyPatternData.distances.length - 1).keys()]) {
      if (journeyPatternData.distances[index] <= distance &&
          journeyPatternData.distances[index + 1] > distance) {
        lastStopIndex = index;
        break;
      }
    }

    // Get the codes of the previous and next stop of the tripData in the journey pattern
    const previousStopCode = pointsInSequence[lastStopIndex];
    const nextStopCode = pointsInSequence[lastStopIndex + 1];

    // Percentage of the distance between the previous and the next stop that is completed
    const percentage = (distance - journeyPatternData.distances[lastStopIndex]) /
                       (journeyPatternData.distances[lastStopIndex + 1] -
                        journeyPatternData.distances[lastStopIndex]);

    // Get segment of the network on which the vehicle is now
    const currentSegment = this.projectNetwork[`${previousStopCode}|${nextStopCode}`];

    return currentSegment.stopAreasSegment.getPointByPercentage(percentage);
  }

  /**
   * Extracts all the trips given a filter function that returns true when the trip is to be kept
   * @param  {Function} filterFunction - The function used to filter the trips
   * @return {Object} The filtered trips object
   */
  _getFilteredTrips(filterFunction) {
    const trips = {};
    for (const [tripCode, tripData] of Object.entries(this.data.vehicleJourneys)) {
      if (filterFunction(tripData)) trips[tripCode] = tripData;
    }
    return trips;
  }

  /**
   * Determines if a trip is to be considered active or not.
   * The function needs to be curried with the time before using it.
   * @param  {Number}  time - Time in seconds since noon minus 12h
   * @return {Boolean} True if trip is active, false otherwise.
   */
  static isActiveTrip(time) {
    return tripData => (tripData.times[0] <= time &&
                        tripData.times[tripData.times.length - 1] >= time);
  }

  /**
   * Get all the active trips with their position at a given time.
   * @param  {Number} time - Time to get the trips at
   * @param  {Function} filterFunc - Optional function to filter the trips
   * @return {Object} - Active trips with their position,
   *                    in the {tripCode: 123, position: Point(123, 456 )} format
   */
  _getTripsAtTime(time, filterFunc) {
    const activeTrips = this._getFilteredTrips(PTDS.isActiveTrip(time));

    const tripPositions = [];
    for (const [tripCode, tripData] of Object.entries(activeTrips)) {
      // Consider the trip only if there is no filter function or the filter function
      // does not filter out the trip (returns true)
      if (typeof filterFunc === 'undefined' || filterFunc(tripData)) {
        const tripDistance = this._getTripDistanceAtTime(tripData, time);
        const tripPosition = this._getTripPositionFromDistance(tripData, tripDistance);
        tripPositions.push({
          tripCode,
          position: tripPosition,
        });
      }
    }

    return tripPositions;
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

      this.map.updateData({ trips: this._getTripsAtTime(vizTime) });
      this.map._drawTrips();
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
