import * as log from 'loglevel';
import Point from './point';
import Segment from './segment';

/**
 * This class manages the map visualization.
 * The data/state stored by this class is kept at the minimum,
 * only the essential information needed to draw it is stored.
 */
export default class InteractiveMap {
  constructor(data, svgObject, dims, options) {
    // The input data given to this class contains only the information needed to draw it.
    // This means that it has to look like this:
    // {
    //  stops: [{stopCode: 123, position: Point(123, 456)}, ...],
    //  stopAreas: [{stopAreaCode: 123, position: Point(123, 456)}, ...],
    //  links: [{linkID: 123, segment: Segment(Point(12, 34), Point(56, 78))}, ...]
    //  trips: [{tripCode: 123, position: Point(123, 456)}, ...],
    // }
    this.data = data;
    this.svgObject = svgObject;
    this.dims = dims;
    this.options = options;

    this._createGroups();
    this._computeCoordinatesMapping();

    this.draw();
  }

  /**
   * Update the data/state of the map with a newer version
   * @param  {Object} newData - Object which properties will overwrite the existing ones.
   */
  updateData(newData) {
    Object.assign(this.data, newData);
  }

  /**
   * Draws the map, including: stops, stopAreas, links and trips.
   */
  draw() {
    if (this.options.showStops) { this._drawStops(); }
    this._drawStopAreas();
    this._drawLinks();
    this._drawTrips();
  }

  /**
   * Create the SVG groups for links, stops, stopAreas and trips
   */
  _createGroups() {
    this.stopsGroup = this.svgObject.append('g')
      .attr('id', 'stops');
    this.linksGroup = this.svgObject.append('g')
      .attr('id', 'links');
    this.stopAreasGroup = this.svgObject.append('g')
      .attr('id', 'stopAreas');
    this.tripsGroup = this.svgObject.append('g')
      .attr('id', 'trips');
  }


  /**
   * Computes the information needed to map a point in the Dutch grid to a point in the canvas
   */
  _computeCoordinatesMapping() {
    // First, we find the minimum and maximum coordinates of the stops in the grid
    this.stopsMinX = Number.MAX_VALUE;
    this.stopsMinY = Number.MAX_VALUE;
    this.stopsMaxX = Number.MIN_VALUE;
    this.stopsMaxY = Number.MIN_VALUE;

    // Iterate over all the stops first to find stopsMinX, stopsMinY, stopsMaxX, stopsMaxY
    for (const { position } of this.data.stops) {
      if (position.x < this.stopsMinX) this.stopsMinX = position.x;
      if (position.y < this.stopsMinY) this.stopsMinY = position.y;
      if (position.x > this.stopsMaxX) this.stopsMaxX = position.x;
      if (position.y > this.stopsMaxY) this.stopsMaxY = position.y;
    }

    // Find out the aspect ratio of the rectangle containing all the stops
    // and of the canvas
    this.stopsGridAspectRatio = (this.stopsMaxX - this.stopsMinX) /
                                (this.stopsMaxY - this.stopsMinY);
    this.mapAspectRatio = this.dims.innerWidth / this.dims.innerHeight;
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
      const verticalCenteringAdjustment = (this.dims.innerHeight -
                                          (this.dims.innerWidth / this.stopsGridAspectRatio))
                                          / 2;
      const mappedPoint = new Point(
        ((point.x - this.stopsMinX) * this.dims.innerWidth) /
        (this.stopsMaxX - this.stopsMinX),
        (((point.y - this.stopsMinY) * (this.dims.innerWidth / this.stopsGridAspectRatio)) /
        (this.stopsMaxY - this.stopsMinY)) + verticalCenteringAdjustment,
      );

      // Mirror along horizontal axis
      mappedPoint.y = this.dims.innerHeight - mappedPoint.y;
      return mappedPoint;
    }

    // Height is constrained to fit the height of the canvas
    // Width is adapted consequently, keeping the same aspect ratio
    const horizontalCenteringAdjustment = (this.dims.innerWidth -
                                          (this.dims.innerHeight * this.stopsGridAspectRatio))
                                          / 2;
    const mappedPoint = new Point(
      (((point.x - this.stopsMinX) * (this.dims.innerHeight * this.stopsGridAspectRatio)) /
      (this.stopsMaxX - this.stopsMinX)) + horizontalCenteringAdjustment,
      ((point.y - this.stopsMinY) * this.dims.innerHeight) /
      (this.stopsMaxY - this.stopsMinY),
    );

    mappedPoint.y = this.dims.innerHeight - mappedPoint.y;
    return mappedPoint;
  }

  /**
   * Draws the stops
   */
  _drawStops() {
    // Create (empty at first) selection
    const stops = this.stopsGroup.selectAll('g.stop')
      .data(
        // Before binding the stops data to the selection,
        // we transform their position from dutch grid to canvas
        this.data.stops.map(({ stopCode, position }) => ({
          stopCode,
          position: this._mapToCanvas(position),
        })),
        // Use the stop code as key
        ({ stopCode }) => stopCode,
      );

    // Remove deleted stops
    stops.exit().remove();

    // Update selection
    stops
      .attr('transform', ({ position }) => `translate(${position.x},${position.y})`);

    // Enter selection
    const stopsGroups = stops.enter().append('g')
      .attr('class', 'stop')
      // Attach the stop code as an attribute to the SVG element, can turn out useful later
      .attr('data-stop-code', ({ stopCode }) => stopCode)
      .attr('transform', ({ position }) =>
        `translate(${position.x},${position.y})`);

    stopsGroups
      .append('circle')
      .attr('cx', 0)
      .attr('cy', 0)
      .attr('r', this.options.stopRadius)
      .on('click', function f() {
        const { stopCode } = this.parentNode.dataset;
        log.info(`Clicked on stop ${stopCode}`);
      });

    stopsGroups
      .append('text')
      .attr('x', 0)
      .attr('y', 1)
      .text(({ stopCode }) => stopCode);
  }

  /**
   * Draws the stop areas
   */
  _drawStopAreas() {
    const stopAreas = this.stopAreasGroup.selectAll('g.stopArea')
      .data(
        this.data.stopAreas.map(({ stopAreaCode, position }) => ({
          stopAreaCode,
          position: this._mapToCanvas(position),
        })),
        ({ stopAreaCode }) => stopAreaCode,
      );

    stopAreas.exit().remove();

    // Update selection
    stopAreas
      .attr('transform', ({ position }) => `translate(${position.x},${position.y})`);

    // Enter selection
    const stopAreasGroups = stopAreas.enter().append('g')
      .attr('class', 'stopArea')
      .attr('data-stop-area-code', ({ stopAreaCode }) => stopAreaCode)
      .attr('transform', ({ position }) =>
        `translate(${position.x},${position.y})`);

    stopAreasGroups
      .append('circle')
      .attr('cx', 0)
      .attr('cy', 0)
      .attr('r', this.options.stopAreaRadius)
      .on('click', function f() {
        const { stopAreaCode } = this.parentNode.dataset;
        log.info(`Clicked on stop area ${stopAreaCode}`);
      });

    stopAreasGroups
      .append('text')
      .attr('x', 0)
      .attr('y', -1)
      .text(({ stopAreaCode }) => stopAreaCode);
  }

  /**
   * Draws the links
   */
  _drawLinks() {
    const links = this.linksGroup.selectAll('line.link')
      .data(
        // Similarly to what we did for stops and stopAreas, we
        // transform the segment to canvas position from dutch grid
        // before binding it to the selection (and therefore drawing it)
        this.data.links.map(({ linkID, segment }) => ({
          linkID,
          segment: new Segment(
            this._mapToCanvas(segment.pointA),
            this._mapToCanvas(segment.pointB),
          ),
        })),
        ({ linkID }) => linkID,
      );

    links.exit().remove();

    links
      .attr('x1', ({ segment }) => segment.pointA.x)
      .attr('y1', ({ segment }) => segment.pointA.y)
      .attr('x2', ({ segment }) => segment.pointB.x)
      .attr('y2', ({ segment }) => segment.pointB.y);

    links.enter().append('line')
      .attr('class', 'link')
      .attr('data-link-id', ({ linkID }) => linkID)
      .attr('x1', ({ segment }) => segment.pointA.x)
      .attr('y1', ({ segment }) => segment.pointA.y)
      .attr('x2', ({ segment }) => segment.pointB.x)
      .attr('y2', ({ segment }) => segment.pointB.y)
      .on('click', function f() {
        const { linkId } = this.parentNode.dataset;
        log.info(`Clicked on link ${linkId}`);
      });
  }

  /**
   * Draw the trips
   */
  _drawTrips() {
    const trips = this.tripsGroup.selectAll('g.trip')
      .data(
        this.data.trips.map(({ tripCode, position }) => ({
          tripCode,
          position: this._mapToCanvas(position),
        })),
        ({ tripCode }) => tripCode,
      );

    trips.exit().remove();

    trips
      .attr('transform', ({ position }) => `translate(${position.x},${position.y})`);

    // Enter selection
    const tripsGroups = trips.enter().append('g')
      .attr('class', 'trip')
      .attr('data-trip-code', ({ tripCode }) => tripCode)
      .attr('transform', ({ position }) => `translate(${position.x},${position.y})`);

    tripsGroups
      .append('circle')
      .attr('cx', 0)
      .attr('cy', 0)
      .attr('r', this.options.tripRadius)
      .on('click', function f() {
        const { tripCode } = this.parentNode.dataset;
        log.info(`Clicked on trip ${tripCode}`);
      });

    tripsGroups
      .append('text')
      .attr('x', 0)
      .attr('y', -1)
      .text(({ tripCode }) => tripCode);
  }
}
