import Point from './point.js';
import Segment from './segment.js';

/**
 * Main PTDS class
 */
class PTDS {
  constructor(inputData, options) {
    this.journeyPatterns = inputData.journeyPatterns;
    this.scheduledStopPoints = inputData.scheduledStopPoints;
    this.vehicleJourneys = inputData.vehicleJourneys;

    this.options = options;

    this._createSVG();
    this._computeCoordinatesMapping();
    this._computeStopAreasAggregation();
    this._computeProjectNetwork();

    if (options.showLinks) this.drawJourneyPatternsLinks();
    if (options.showStops) this.drawStops();
    if (options.showStopAreas) this.drawStopAreas();

    this.drawMareyDiagram();
  }

  _createSVG() {
    // Get browser dimensions
    // The (-4) correction factor is due to the fact that the browser
    // will show the scrollbars even if the visualization is the same size
    // as the browser window, for no apparent reason. This way
    // the scrollbars are not shown.
    const windowWidth = window.innerWidth - 4;
    const windowHeight = window.innerHeight - 4;

    // D3 margin convention https://bl.ocks.org/mbostock/3019563
    const margin = {
      top: 20,
      right: 20,
      bottom: 20,
      left: 20,
    };

    // Marey diagram is on the left. Map on the right
    // We compute the outer width of the two elements basing on the split percentage
    const mareyOuterWidth = windowWidth * this.options.verticalSplitPercentage;
    const mapOuterWidth = windowWidth * (1 - this.options.verticalSplitPercentage);

    this.mareyInnerWidth = mareyOuterWidth - margin.left - margin.right;
    this.mapInnerWidth = mapOuterWidth - margin.left - margin.right;

    // As outer height for both the Marey diagram and the map we use the window height
    this.mareyInnerHeight = windowHeight - margin.top - margin.bottom;
    this.mapInnerHeight = this.mareyInnerHeight;

    // Create main map SVG element applying the margins
    this.mareySVG = d3.select('body').append('svg')
      .attr('id', 'marey')
      .attr('width', mareyOuterWidth)
      .attr('height', windowHeight)
      .attr('style', 'outline: thin solid black;')
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Create main map SVG element applying the margins
    this.mapSVG = d3.select('body').append('svg')
      .attr('id', 'map')
      .attr('width', mapOuterWidth)
      .attr('height', windowHeight)
      .attr('style', 'outline: thin solid black;')
      .call(d3.zoom().on('zoom', () => this.mapSVG.attr('transform', d3.event.transform)))
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    this.stopsGroup = this.mapSVG.append('g').attr('id', 'stops');
    this.linksGroup = this.mapSVG.append('g').attr('id', 'links');
    this.stopAreasGroup = this.mapSVG.append('g').attr('id', 'stopAreas');
    this.tripsGroup = this.mapSVG.append('g').attr('id', 'trips');
  }

  /**
   * Computes the information needed to map the stops in the dataset
   * to the canvas
   */
  _computeCoordinatesMapping() {
    // First, we find the minimum and maximum coordinates of the stops in the grid
    this.stopsMinX = Number.MAX_VALUE;
    this.stopsMinY = Number.MAX_VALUE;
    this.stopsMaxX = Number.MIN_VALUE;
    this.stopsMaxY = Number.MIN_VALUE;

    // Iterate over all the stops first to find stopsMinX, stopsMinY, stopsMaxX, stopsMaxY
    for (const stopData of Object.values(this.scheduledStopPoints)) {
      if (stopData.x < this.stopsMinX) this.stopsMinX = stopData.x;
      if (stopData.y < this.stopsMinY) this.stopsMinY = stopData.y;
      if (stopData.x > this.stopsMaxX) this.stopsMaxX = stopData.x;
      if (stopData.y > this.stopsMaxY) this.stopsMaxY = stopData.y;
    }

    // Find out the aspect ratio of the rectangle containing all the stops
    // and of the canvas
    this.stopsGridAspectRatio = (this.stopsMaxX - this.stopsMinX) /
                                (this.stopsMaxY - this.stopsMinY);
    this.mapAspectRatio = this.mapInnerWidth / this.mapInnerHeight;
  }

  /**
   * Computes the aggregation of stops into stop areas
   */
  _computeStopAreasAggregation() {
    // Aggregate stops into stop areas
    const stopAreasAggregation = {};
    for (const [stopCode, stopData] of Object.entries(this.scheduledStopPoints)) {
      if (Object.prototype.hasOwnProperty.call(stopAreasAggregation, stopData.area)) {
        stopAreasAggregation[stopData.area].stops[stopCode] = {
          x: stopData.x,
          y: stopData.y,
        };
      } else {
        stopAreasAggregation[stopData.area] = {
          name: stopData.name,
          stops: {
            [stopCode]: {
              x: stopData.x,
              y: stopData.y,
            },
          },
        };
      }
    }

    // Iterate over all the areas to compute coordinates of area as average of
    // the coordinates of the stops
    for (const stopAreaData of Object.values(stopAreasAggregation)) {
      // Create array of Points corresponding to the stops belonging to the current stop area
      const stopAreaStopsPoints = Object.values(stopAreaData.stops).map(stopData =>
        new Point(stopData.x, stopData.y));
      // Compute the centroid of the stop area
      const centroid = Point.centroid(stopAreaStopsPoints);
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
    for (const journeyPatternData of Object.values(this.journeyPatterns)) {
      // Get list of stops of current journey pattern
      const stopsList = journeyPatternData.pointsInSequence;

      // Iterate over pairs of stops and add them to the project definition
      for (const index of [...Array(stopsList.length - 1).keys()]) {
        const stopAcode = stopsList[index];
        const stopBcode = stopsList[index + 1];

        // Get coordinates of current pair of stops
        const stopAdata = this.scheduledStopPoints[stopAcode];
        const stopBdata = this.scheduledStopPoints[stopBcode];

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
   * Maps a position in the Dutch grid to a position in the canvas
   * maximizing the dimension of the rectangle containing the stops but maintaining
   * the original aspect ratio.
   * @param  {Point} point - The point in Dutch grid coordinates to map to the canvas coordinates
   * @return {Point} The point with coordinates in the canvas
   */
  _mapToCanvas(point) {
    if (this.stopsGridAspectRatio > this.mapAspectRatio) {
      // Width is constrained to fit in the width of the canvas
      // Height is adapted consequently, keeping the same aspect ratio
      const verticalCenteringAdjustment = (this.mapInnerHeight -
                                          (this.mapInnerWidth / this.stopsGridAspectRatio)) / 2;
      return new Point(
        ((point.x - this.stopsMinX) * this.mapInnerWidth) /
        (this.stopsMaxX - this.stopsMinX),
        (((point.y - this.stopsMinY) * (this.mapInnerWidth / this.stopsGridAspectRatio)) /
        (this.stopsMaxY - this.stopsMinY)) + verticalCenteringAdjustment,
      );
    }

    // Height is constrained to fit the height of the canvas
    // Width is adapted consequently, keeping the same aspect ratio
    const horizontalCenteringAdjustment = (this.mapInnerWidth -
                                          (this.mapInnerHeight * this.stopsGridAspectRatio)) / 2;
    return new Point(
      (((point.x - this.stopsMinX) * (this.mapInnerHeight * this.stopsGridAspectRatio)) /
      (this.stopsMaxX - this.stopsMinX)) + horizontalCenteringAdjustment,
      ((point.y - this.stopsMinY) * this.mapInnerHeight) /
      (this.stopsMaxY - this.stopsMinY),
    );
  }

  /**
   * Get the distance traveled by a vehicle in its trip along its journeypattern
   * @param  {Object} tripData - Data of a trip
   * @param  {Number} time - Time expressed as seconds since noon minus 12h
   * @return {Number} Current distance traveled by the vehicle in its trip
   */
  _getTripDistanceAtTime(tripData, time) {
    const journeyPatternData = this.journeyPatterns[tripData.journeyPatternRef];
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
    const journeyPatternData = this.journeyPatterns[tripData.journeyPatternRef];
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
   * Get trips/vehicleJourneys that are active at the given time
   * @param  {Number} time - Time expressed as seconds since noon minus 12h
   * @return {Object} Active trips
   */
  _getActiveTrips(time) {
    // A trip is active if the time of the first stop is smaller (or equal) than the current time
    // and the time of the last stop if greater (or equal) than the current time
    const isActiveTrip = trip => (trip.times[0] <= time &&
                                  trip.times[trip.times.length - 1] >= time);

    const activeTrips = {};
    for (const [tripCode, tripData] of Object.entries(this.vehicleJourneys)) {
      if (isActiveTrip(tripData)) activeTrips[tripCode] = tripData;
    }

    return activeTrips;
  }

  /**
   * Compute the number of seconds elapsed from noon minus 12h till now,
   * which is typically midnight except for when daylight savings time is on
   * @return {Number} seconds elapsed since noon minus 12h till now
   */
  static currentTimeInSecsSinceMidnight() {
    const currentTime = new Date();
    const noonTime = (new Date(currentTime)).setHours(12, 0, 0, 0);
    const millisecondsSinceNoon = currentTime - noonTime;
    const secondsSinceNoon = Math.floor(millisecondsSinceNoon / 1000);
    const secondsSinceMidnight = secondsSinceNoon + (12 * 60 * 60);

    return secondsSinceMidnight;
  }

  /**
   * Draws the stops in map as circles
   */
  drawStops() {
    const stops = this.stopsGroup.selectAll('circle.stop')
      .data(Object.values(this.scheduledStopPoints).map(stopData =>
        this._mapToCanvas(new Point(stopData.x, stopData.y))));

    stops.enter().append('circle')
      .attr('class', 'stop')
      .attr('cx', point => point.x)
      .attr('cy', point => point.y)
      .attr('r', this.options.stopRadius);
  }

  /**
   * Draws the stop areas in the map as red bigger circles
   */
  drawStopAreas() {
    const stopAreas = this.stopAreasGroup.selectAll('circle.stopArea')
      .data(Object.values(this.stopAreasAggregation).map(stopAreaData =>
        this._mapToCanvas(stopAreaData.centroid)));

    stopAreas.enter().append('circle')
      .attr('class', 'stopArea')
      .attr('cx', point => point.x)
      .attr('cy', point => point.y)
      .attr('r', this.options.stopAreaRadius);
  }

  /**
   * Draws all the links between areas contained in the project definition
   */
  drawJourneyPatternsLinks() {
    const links = this.linksGroup.selectAll('line.link')
      .data(Object.values(this.projectNetwork).map(linkData => ({
        stopAareaCentroidInCanvas: this._mapToCanvas(linkData.stopAreasSegment.pointA),
        stopBareaCentroidInCanvas: this._mapToCanvas(linkData.stopAreasSegment.pointB),
      })));

    links.enter().append('line')
      .attr('class', 'link')
      .attr('x1', segment => segment.stopAareaCentroidInCanvas.x)
      .attr('y1', segment => segment.stopAareaCentroidInCanvas.y)
      .attr('x2', segment => segment.stopBareaCentroidInCanvas.x)
      .attr('y2', segment => segment.stopBareaCentroidInCanvas.y);
  }

  /**
   * Draw the trips/vehicleJourneys at a given time
   * @param  {Number} time - Time in seconds since noon minus 12h
   */
  drawTripsAtTime(time) {
    const activeTrips = this._getActiveTrips(time);

    const tripPositions = [];
    for (const [tripCode, tripData] of Object.entries(activeTrips)) {
      const tripDistance = this._getTripDistanceAtTime(tripData, time);
      const tripPosition = this._getTripPositionFromDistance(tripData, tripDistance);
      const tripPositionInCanvas = this._mapToCanvas(tripPosition);
      tripPositions.push({
        tripCode,
        tripPosition: tripPositionInCanvas,
      });
    }

    const trips = this.tripsGroup.selectAll('circle.trip')
      .data(tripPositions, trip => trip.tripCode);

    // Remove from the visualization the trips that are not active anymore
    trips.exit().remove();

    // Update the coordinates of the existing active trips
    trips
      .attr('cx', trip => trip.tripPosition.x)
      .attr('cy', trip => trip.tripPosition.y);

    // Add to the visualization the trips that just became active
    trips.enter().append('circle')
      .attr('class', 'trip')
      .attr('data-tripcode', trip => trip.tripCode)
      .attr('cx', trip => trip.tripPosition.x)
      .attr('cy', trip => trip.tripPosition.y)
      .attr('r', this.options.tripRadius);
  }

  /**
   * Creates the Marey diagram visualization
   */
  drawMareyDiagram() {
    // Just for testing, draw a circle temporarily
    this.mareySVG.append('circle')
      .attr('cx', this.mareyInnerWidth / 2)
      .attr('cy', this.mareyInnerHeight / 2)
      .attr('r', 20);
  }

  /**
   * Start a 'spiral simulation' showing on the map all the trips from the current time of the day
   * till the end of the day, then go back to the start time and loop.
   * @param  {number} timeMultiplier - Conversion factor between real and visualization time
   */
  spiralSimulation(timeMultiplier) {
    const startTimeViz = PTDS.currentTimeInSecsSinceMidnight();

    d3.timer((elapsedMilliseconds) => {
      // Compute elapsed seconds in the visualization
      const elapsedSecondsInViz = (elapsedMilliseconds * timeMultiplier) / 1000;
      // Compute 'spiral' negative offset.
      // There are two parameters for the spiral effect.
      // Every paramA seconds the vehicles are sent back in time by paramB seconds.
      const paramA = 60;
      const paramB = 30;
      const spiralOffset = Math.floor(elapsedSecondsInViz / paramA) * paramB;

      // When the time of the visualization reaches the end of the day,
      // go back to the initial start time
      const vizTime = startTimeViz +
        ((elapsedSecondsInViz - spiralOffset) % (115200 - startTimeViz));

      this.drawTripsAtTime(vizTime);
    });
  }
}

// Load JSON data asynchronously
d3.queue()
  .defer(d3.json, 'data/test.json')
  .await((error, data) => {
    const ptds = new PTDS(data, {
      stopRadius: 1,
      stopAreaRadius: 1,
      tripRadius: 1,
      showStops: false,
      showStopAreas: true,
      showLinks: true,
      verticalSplitPercentage: 0.5,
    });

    // Multiplier between time in the visualization and real time
    // 1 real second corresponds to timeMultiplier seconds in the visualization
    const timeMultiplier = 60;
    ptds.spiralSimulation(timeMultiplier);
  });