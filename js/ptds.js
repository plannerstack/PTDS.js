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

    if (options.showLinks) this._drawJourneyPatternsLinks();
    if (options.showStops) this._drawStops();
    if (options.showStopAreas) this._drawStopAreas();

    this._drawMareyDiagram('HTM:1:363');
  }

  _createSVG() {
    // Get browser dimensions
    // The correction factors are needed because the actual size
    // available is less than the one returned by the browser due to scrollbars
    // and other elements that take up space.
    const windowWidth = window.innerWidth - 15;
    const windowHeight = window.innerHeight - 5;

    // D3 margin convention https://bl.ocks.org/mbostock/3019563
    const mareyMargin = {
      top: 80,
      right: 50,
      bottom: 20,
      left: 50,
    };
    const mapMargin = {
      top: 20,
      right: 20,
      bottom: 20,
      left: 20,
    };

    // Marey diagram is on the left. Map on the right
    // We compute the outer width of the two elements basing on the split percentage
    const mareyOuterWidth = windowWidth * this.options.verticalSplitPercentage;
    const mapOuterWidth = windowWidth * (1 - this.options.verticalSplitPercentage);

    this.mareyOuterHeight = windowHeight * this.options.mareyHeightMultiplier;

    this.mareyInnerWidth = mareyOuterWidth - mareyMargin.left - mareyMargin.right;
    this.mapInnerWidth = mapOuterWidth - mapMargin.left - mapMargin.right;

    // As outer height for both the Marey diagram and the map we use the window height
    this.mareyInnerHeight = this.mareyOuterHeight - mareyMargin.top - mareyMargin.bottom;
    this.mapInnerHeight = windowHeight - mareyMargin.top - mareyMargin.bottom;

    // Create main map SVG element applying the margins
    this.mareySVG = d3.select('div.main').append('div')
      .attr('id', 'marey-container')
      .style('height', `${windowHeight}px`)
      .append('svg')
      .attr('id', 'marey')
      .attr('width', mareyOuterWidth)
      .attr('height', this.mareyOuterHeight)
      .append('g')
      .attr('transform', `translate(${mareyMargin.left},${mareyMargin.top})`);

    // Create main map SVG element applying the margins
    this.mapSVG = d3.select('div.main').append('div')
      .attr('id', 'map-container')
      .style('height', `${windowHeight}px`)
      .append('svg')
      .attr('id', 'map')
      .attr('width', mapOuterWidth)
      .attr('height', windowHeight)
      .call(d3.zoom().on('zoom', () => this.mapSVG.attr('transform', d3.event.transform)))
      .append('g')
      .attr('transform', `translate(${mapMargin.left},${mapMargin.top})`);

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
   * Extracts all the trips given a filter function that returns true when the trip is to be kept
   * @param  {Function} filterFunction - The function used to filter the trips
   * @return {Object} The filtered trips object
   */
  _getFilteredTrips(filterFunction) {
    const trips = {};
    for (const [tripCode, tripData] of Object.entries(this.vehicleJourneys)) {
      if (filterFunction(tripData)) trips[tripCode] = tripData;
    }
    return trips;
  }

  /**
   * Converts a time in HH:MM:SS format to the time in seconds since noon minus 12h
   * TODO: Does it work correctly with daylight savings time? Does it make sense to consider this?
   * @param  {String} timeInHHMMSS - Time in HH:SS:MM format
   * @return {Number} - Time in seconds since midnight
   */
  static _HHMMSStoSeconds(timeInHHMMSS) {
    const [hours, minutes, seconds] = timeInHHMMSS.split(':');

    return (parseInt(hours, 10) * 3600) + (parseInt(minutes, 10) * 60) + parseInt(seconds, 10);
  }

  /**
   * Converts a time in seconds since noon minus 12h to the HH:MM:SS format
   * TODO: Does it work correctly with daylight savings time? Does it make sense to consider this?
   * @param  {Number} timeInSecondsSinceNoonMinus12h - Time in seconds since noon minus 12h
   * @return {String} - Time in HH:MM:SS format
   */
  static _secondsToHHMMSS(timeInSecondsSinceNoonMinus12h) {
    const hours = Math.floor(timeInSecondsSinceNoonMinus12h / 3600);
    const minutes = Math.floor((timeInSecondsSinceNoonMinus12h % 3600) / 60);
    const seconds = Math.floor((timeInSecondsSinceNoonMinus12h % 3600) % 60);

    // Helper function to get a positive integer < 100 padded with a zero in front if < 10
    const twoDigits = number => `0${number}`.slice(-2);

    return `${twoDigits(hours)}:${twoDigits(minutes)}:${twoDigits(seconds)}`;
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
   * Draws the stops in map as circles
   */
  _drawStops() {
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
  _drawStopAreas() {
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
  _drawJourneyPatternsLinks() {
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
   * @param  {Function} filterFunc - Optional, function to use to filter the trips
   */
  drawTripsAtTime(time, filterFunc) {
    const activeTrips = this._getFilteredTrips(PTDS.isActiveTrip(time));

    const tripPositions = [];
    for (const [tripCode, tripData] of Object.entries(activeTrips)) {
      // Draw the trip only if there is no filter function or the filter function
      // does not filter out the trip (returns true)
      if (typeof filterFunc === 'undefined' || filterFunc(tripData)) {
        const tripDistance = this._getTripDistanceAtTime(tripData, time);
        const tripPosition = this._getTripPositionFromDistance(tripData, tripDistance);
        const tripPositionInCanvas = this._mapToCanvas(tripPosition);
        tripPositions.push({
          tripCode,
          tripPosition: tripPositionInCanvas,
        });
      }
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
   * Draws the Marey diagram.
   * For now, it only draws the data corresponding to a single journeypattern.
   * @param  {String} journeyPatternCode - Code of the journeypattern to show
   */
  _drawMareyDiagram(journeyPatternCode) {
    /* eslint-disable no-unused-vars */
    // First, we get all the trips of this journey pattern so that we can compute
    // start and end time of the diagram
    const jpTrips = this._getFilteredTrips(tripData =>
      tripData.journeyPatternRef === journeyPatternCode);

    // Iterate over all the trips of the chosen journey pattern to find minimum and maximum time
    let [minTime, maxTime] = [Number.MAX_VALUE, Number.MIN_VALUE];
    for (const tripData of Object.values(jpTrips)) {
      const firstTime = tripData.times[0];
      const lastTime = tripData.times[tripData.times.length - 1];
      if (firstTime < minTime) minTime = firstTime;
      if (lastTime > maxTime) maxTime = lastTime;
    }

    // Parses a time in HH:MM:SS format to date object
    const parseTime = d3.timeParse('%H:%M:%S');
    // Formatting function for the y (time) axis
    const axisTickFormat = d3.timeFormat('%H:%M');

    // Scale for the y axis (time)
    const yScale = d3.scaleTime()
      .domain([
        parseTime(PTDS._secondsToHHMMSS(minTime)),
        parseTime(PTDS._secondsToHHMMSS(maxTime)),
      ])
      .range([0, this.mareyInnerHeight]);

    // Left and right axes
    const yLeftAxis = d3.axisLeft(yScale)
      .ticks(d3.timeMinute.every(20))
      .tickFormat(axisTickFormat);

    const yRightAxis = d3.axisRight(yScale)
      .ticks(d3.timeMinute.every(20))
      .tickFormat(axisTickFormat);

    // Create axes groups
    this.mareySVG.append('g')
      .attr('class', 'left-axis axis')
      .call(yLeftAxis);

    this.mareySVG.append('g')
      .attr('class', 'right-axis axis')
      .attr('transform', `translate(${this.mareyInnerWidth},0)`)
      .call(yRightAxis);

    // Initial time at which the timeline is positioned. For now we position it
    // at one minute after the time of the first trip.
    const initialTimelineTime = parseTime(PTDS._secondsToHHMMSS(minTime + 60));
    const initialTimelineYpos = yScale(initialTimelineTime);
    const timelineTimeFormatter = d3.timeFormat('%H:%M:%S');

    // Timeline group creation
    const timeline = this.mareySVG.append('g')
      .attr('class', 'timeline')
      .attr('transform', `translate(0,${initialTimelineYpos})`);

    // Horizontal line of the timeline
    timeline.append('line')
      .attr('x1', 0)
      .attr('x2', this.mareyInnerWidth);

    // Label with the time of the timeline
    timeline.append('text')
      .text(timelineTimeFormatter(initialTimelineTime))
      .attr('x', 5)
      .attr('y', -5);

    // Create overlay to handle timeline movement with mouse
    this.mareySVG.append('rect')
      .attr('id', 'mouse-move-overlay')
      .attr('width', this.mareyInnerWidth)
      .attr('height', this.mareyInnerHeight)
      .on('mousemove', () => {
        // d3.mouse wants a DOM element, so get it by its ID
        const overlay = document.getElementById('mouse-move-overlay');
        // Get the mouse position relative to the overlay
        let yPos = d3.mouse(overlay)[1];
        // Keep an upper border for the timeline that is never trespassed
        yPos = yPos < initialTimelineYpos ? initialTimelineYpos : yPos;
        // Get the time corresponding to the actual mouse position
        // and format it
        const time = yScale.invert(yPos);
        const formattedTime = timelineTimeFormatter(time);

        this.drawTripsAtTime(
          PTDS._HHMMSStoSeconds(formattedTime),
          tripData => tripData.journeyPatternRef === journeyPatternCode,
        );

        // Update the y position of the timeline group
        d3.select('g.timeline').attr('transform', `translate(0,${yPos})`);
        // Update the text showing the time
        d3.select('g.timeline text').text(formattedTime);
      });

    // Horizontal axis drawing. We want to draw the axis with the stopAreas
    // so first we need to extract the information of the stopAreas related
    // to this journeypattern.
    const journeyPatternData = this.journeyPatterns[journeyPatternCode];

    const xScale = d3.scaleLinear()
      .domain([0, journeyPatternData.distances[journeyPatternData.distances.length - 1]])
      .range([0, this.mareyInnerWidth]);

    const xAxis = d3.axisTop(xScale)
      .tickSize(-this.mareyInnerHeight)
      .tickValues(journeyPatternData.distances)
      .tickFormat((d, index) => journeyPatternData.pointsInSequence[index]);

    this.mareySVG.append('g')
      .attr('class', 'top-axis axis')
      .call(xAxis)
      .selectAll('text')
      .attr('y', 0)
      .attr('x', 5)
      .attr('dy', '.35em');

    const tripsGroup = this.mareySVG.append('g')
      .attr('id', 'trips');

    const trips = tripsGroup.selectAll('g.trip')
      .data(Object.entries(jpTrips));

    const tripLineGenerator = d3.line()
      .x(stopData => xScale(stopData.distance))
      .y(stopData => yScale(stopData.timeParsed));

    trips.enter().append('g')
      .attr('class', 'trip')
      .attr('data-tripcode', ([tripCode, _]) => tripCode)
      .append('path')
      .attr('d', ([_, tripData]) =>
        tripLineGenerator(tripData.times.map((time, index) => ({
          timeParsed: parseTime(PTDS._secondsToHHMMSS(time)),
          distance: journeyPatternData.distances[index],
        }))));
  }

  /**
   * Start a 'spiral simulation' showing on the map all the trips from the current time of the day
   * till the end of the day, then go back to the start time and loop.
   * Every paramA seconds the vehicles are sent back in time by paramB seconds.
   * @param  {Number} timeMultiplier - Conversion factor between real and visualization time
   * @param  {Number} paramA - See above
   * @param  {Number} paramB - See above
   */
  spiralSimulation(timeMultiplier, paramA, paramB) {
    const currentTimeInHHMMSS = d3.timeFormat('%H:%M:%S')(new Date());
    const startTimeViz = PTDS._HHMMSStoSeconds(currentTimeInHHMMSS);

    d3.timer((elapsedMilliseconds) => {
      // Compute elapsed seconds in the visualization
      const elapsedSecondsInViz = (elapsedMilliseconds * timeMultiplier) / 1000;
      // Compute 'spiral' negative offset.
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
      tripRadius: 4,
      showStops: false,
      showStopAreas: true,
      showLinks: true,
      verticalSplitPercentage: (Math.sqrt(5) - 1) / 2,
      mareyHeightMultiplier: 2,
    });

    //ptds.spiralSimulation(60, 60, 30);
  });
