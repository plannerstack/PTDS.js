// Get browser dimensions
const window_width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
const window_height = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;

// D3 margin convention https://bl.ocks.org/mbostock/3019563
const margin = {top: 50, right: 50, bottom: 50, left: 50};
const canvasWidth = window_width - margin.left - margin.right;
const canvasHeight = window_height - margin.top - margin.bottom;

// Create main map SVG element applying the margins
const svg = d3.select('body').append('svg')
    .attr('id', 'map')
    .attr('width', canvasWidth + margin.left + margin.right)
    .attr('height', canvasHeight + margin.top + margin.bottom)
  .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

/**
 * Class representing a generic point on the 2D plane
 */
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  /**
   * Computes the centroid of a sequence of points
   *
   * @param  {Array} points - Array of Point objects
   * @return {Point} point corresponding to the centroid of the given points
   */
  static centroid(points) {
    let totalX = 0;
    let totalY = 0;

    for (const point of points) {
      totalX += point.x;
      totalY += point.y;
    }

    const averageX = totalX / points.length;
    const averageY = totalY / points.length;

    return new Point(averageX, averageY);
  }
}

/**
 * Class representing a segment, with start and end point
 */
class Segment {
  constructor(pointA, pointB) {
    this.pointA = pointA;
    this.pointB = pointB;
  }

  /**
   * Computes a point along the segment given a percentage
   *
   * @param  {Number} percentage - Given a percentage [0.0-1.0] computes the corresponding point in the segment
   * @return {Point} Point corresponding to the percentage given
   */
  getPointByPercentage(percentage) {
    return new Point(
      this.pointA.x + (this.pointB.x - this.pointA.x) * percentage,
      this.pointA.y + (this.pointB.y - this.pointA.y) * percentage
    )
  }
}

/**
 * Main PTDS class
 */
class PTDS {
  constructor(inputData, canvasWidth, canvasHeight, canvasObject) {
    this.journeyPatterns = inputData.journeyPatterns;
    this.scheduledStopPoints = inputData.scheduledStopPoints;
    this.vehicleJourneys = inputData.vehicleJourneys;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.canvasObject = canvasObject;

    this._computeCoordinatesMapping();
    this._computeStopAreasAggregation();
    this._computeProjectNetwork();

    // Radius used to draw the circle representing a stop
    this.stopRadius = 1;
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
    this.canvasAspectRatio = this.canvasWidth /
                             this.canvasHeight;
  }

  /**
   * Computes the aggregation of stops into stop areas
   */
  _computeStopAreasAggregation() {
    // Aggregate stops into stop areas
    let stopAreasAggregation = {};
    for (const [stopCode, stopData] of Object.entries(this.scheduledStopPoints)) {
      if (stopAreasAggregation.hasOwnProperty(stopData.area)) {
        stopAreasAggregation[stopData.area]['stops'][stopCode] = {
          'x': stopData.x,
          'y': stopData.y
        }
      } else {
        stopAreasAggregation[stopData.area] = {
          'name': stopData.name,
          'stops': {[stopCode]: {
              'x': stopData.x,
              'y': stopData.y
          }}
        };
      }
    }

    // Iterate over all the areas to compute coordinates of area as average of
    // the coordinates of the stops
    for (let stopAreaData of Object.values(stopAreasAggregation)) {
      // Create array of Points corresponding to the stops belonging to the current stop area
      const stopAreaStopsPoints = Object.values(stopAreaData.stops).map((stopData) =>
        new Point(stopData.x, stopData.y)
      );
      // Compute the centroid of the stop area
      const centroid = Point.centroid(stopAreaStopsPoints);
      stopAreaData['centroid'] = centroid;
    }

    this.stopAreasAggregation = stopAreasAggregation;
  }

  /**
   * Builds the project network definition, meaning the position in the canvas
   * of the segments representing the links between the stops
   */
  _computeProjectNetwork() {
    let projectNetwork = {};

    // Iterate over all the journey patterns to build the definition
    for (const journeyPatternData of Object.values(this.journeyPatterns)) {
      // Get list of stops of current journey pattern
      const stopsList = journeyPatternData.pointsInSequence;

      // Iterate over pairs of stops and add them to the project definition
      for (let i = 0; i < stopsList.length - 1; i++) {
        const stopAcode = stopsList[i];
        const stopBcode = stopsList[i+1];

        // Get coordinates of current pair of stops
        const stopAdata = this.scheduledStopPoints[stopAcode];
        const stopBdata = this.scheduledStopPoints[stopBcode];

        // Get centroids of stop areas A and B
        const stopAareaCentroid = this.stopAreasAggregation[stopAdata.area].centroid;
        const stopBareaCentroid = this.stopAreasAggregation[stopBdata.area].centroid;

        projectNetwork[`${stopAcode}|${stopBcode}`] = {
          'realSegment': new Segment(
            new Point(stopAdata.x, stopAdata.y),
            new Point(stopBdata.x, stopBdata.y)
          ),
          'stopAreasSegment': new Segment(stopAareaCentroid, stopBareaCentroid)
        };
      }
    }

    this.projectNetwork = projectNetwork;
  }

  /**
   * Maps a position in the Dutch grid to a position in the canvas
   * maximizing the dimension of the rectangle containing the stops but maintaining
   * the original aspect ratio.
   *
   * @param  {Point} point - The point in Dutch grid coordinates to map to the canvas coordinates
   * @return {Point} The point with coordinates in the canvas
   */
  _mapToCanvas(point) {
    if (this.stopsGridAspectRatio > this.canvasAspectRatio) {
      // Width is constrained to fit in the width of the canvas
      // Height is adapted consequently, keeping the same aspect ratio
      return new Point(
        (point.x - this.stopsMinX) * this.canvasWidth /
        (this.stopsMaxX - this.stopsMinX),
        (point.y - this.stopsMinY) * (this.canvasWidth / this.stopsGridAspectRatio) /
        (this.stopsMaxY - this.stopsMinY)
      );
    } else {
      // Height is constrained to fit the height of the canvas
      // Width is adapted consequently, keeping the same aspect ratio
      return new Point(
        (point.x - this.stopsMinX) * (this.canvasHeight * this.stopsGridAspectRatio)  /
        (this.stopsMaxX - this.stopsMinX),
        (point.y - this.stopsMinY) * this.canvasHeight /
        (this.stopsMaxY - this.stopsMinY)
      );
    }
  }

  /**
   * @param  {Object} tripData - Data of a trip
   * @param  {Number} time - Time expressed as seconds since noon minus 12h
   * @return {Number} Current distance traveled by the vehicle in its trip
   */
  _getTripDistanceAtTime(tripData, time) {
    // Find out the index corresponding to the latest time passed currently
    let lastTimeIndex = 0;
    for (let i = 0; i < tripData.times.length - 1; i++) {
      if (tripData.times[i+1] > time) {
        lastTimeIndex = i;
        break;
      }
    }

    // Compute percentage of time between previous and next stop by interpolation
    const percentage = (time - tripData.times[lastTimeIndex]) /
                       (tripData.times[lastTimeIndex+1] - tripData.times[lastTimeIndex]);

    // Use the percentage to compute the actual distance of the vehicle by correspondence
    // to the distance list
    const currentDistance = tripData.distances[lastTimeIndex] +
      percentage * (tripData.distances[lastTimeIndex+1] - tripData.distances[lastTimeIndex]);

    return currentDistance;
  }

  /**
   * @param  {Object} tripData - Data of a trip
   * @param  {Number} distance - Distance along the trip of the vehicle
   * @return {Point} Point in the map in which the vehicle is found now
   */
  _getTripPositionFromDistance(tripData, distance) {
    const journeyPatternData = this.journeyPatterns[tripData.journeyPatternRef];

    // Iterate over the journey pattern to find the previous and the next stop basing on the
    // current distance
    let lastStopIndex = -1;
    for (let i = 0; i < journeyPatternData.distances.length - 1; i++) {
      if (journeyPatternData.distances[i] <= distance &&
          journeyPatternData.distances[i+1] > distance) {
        lastStopIndex = i;
        break;
      }
    }

    // Get the codes of the previous and next stop of the tripData in the journey pattern
    const previousStopCode = journeyPatternData.pointsInSequence[lastStopIndex];
    const nextStopCode = journeyPatternData.pointsInSequence[lastStopIndex+1];

    // Percentage of the distance between the previous and the next stop that is completed
    const percentage = (distance - journeyPatternData.distances[lastStopIndex]) /
                       (journeyPatternData.distances[lastStopIndex+1] - journeyPatternData.distances[lastStopIndex]);

    // Get segment of the network on which the vehicle is now
    const currentSegment = this.projectNetwork[`${previousStopCode}|${nextStopCode}`];

    return currentSegment.getPointByPercentage(percentage);
  }

  /**
   * @param  {Number} time - Time expressed as seconds since noon minus 12h
   * @return {Object} Active trips
   */
  _getActiveTrips(time) {
    // A trip is active if the time of the first stop is smaller (or equal) than the current time and
    // the time of the last stop if greater (or equal) than the current time
    let isActiveTrip = (trip) => (trip.times[0] <= time && trip.times[trip.times.length - 1] >= time);

    let activeTrips = {};
    for (const [tripCode, tripData] of Object.entries(this.vehicleJourneys)) {
      if (isActiveTrip(tripData)) activeTrips[tripCode] = tripData;
    }

    return activeTrips;
  }

  /**
   * Draws the stops in map as circles
   */
  drawStops() {
    this.stopsGroup = this.canvasObject.append('g').attr('id', 'stops');

    this.stopsGroup.selectAll('circle.stop')
      .data(Object.values(this.scheduledStopPoints).map((stopData) => this._mapToCanvas(new Point(stopData.x, stopData.y))))
      .enter()
      .append('circle')
        .attr('class', 'stop')
        .attr('cx', (d) => d.x)
        .attr('cy', (d) => d.y)
        .attr('r', this.stopRadius);

    this.stopsGroup.exit().remove();
  }

  /**
   * Draws the stop areas in the map as red bigger circles
   */
  drawStopAreas() {
    this.stopAreasGroup = this.canvasObject.append('g').attr('id', 'stopAreas');

    this.stopAreasGroup.selectAll('circle.stopArea')
      .data(Object.values(this.stopAreasAggregation).map((stopAreaData) => this._mapToCanvas(stopAreaData.centroid)))
      .enter()
      .append('circle')
        .attr('class', 'stopArea')
        .attr('cx', (d) => d.x)
        .attr('cy', (d) => d.y)
        .attr('r', this.stopRadius * 2)
        .style('opacity', 0.5);

    this.stopsGroup.exit().remove();
  }

  /**
   * Draws all the links between areas contained in the project definition
   */
  drawJourneyPatternsLinks() {
    this.linksGroup = this.canvasObject.append('g').attr('id', 'links');

    this.linksGroup.selectAll('line.link')
      .data(Object.values(this.projectNetwork).map((linkData) => ({
        'stopAareaCentroidInCanvas': this._mapToCanvas(linkData.stopAreasSegment.pointA),
        'stopBareaCentroidInCanvas': this._mapToCanvas(linkData.stopAreasSegment.pointB)
      })))
      .enter()
      .append('line')
        .attr('class', 'link')
        .attr('x1', (d) => d.stopAareaCentroidInCanvas.x)
        .attr('y1', (d) => d.stopAareaCentroidInCanvas.y)
        .attr('x2', (d) => d.stopBareaCentroidInCanvas.x)
        .attr('y2', (d) => d.stopBareaCentroidInCanvas.y);
  }
}

// Load JSON data asynchronously
d3.queue()
  .defer(d3.json, 'data/test.json')
  .await((error, data) => {
    var ptds = new PTDS(data, canvasWidth, canvasHeight, svg);

    ptds.drawStops();
    ptds.drawStopAreas();
    ptds.drawJourneyPatternsLinks();
});
