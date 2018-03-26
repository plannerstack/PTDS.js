import { timeParse, timeFormat } from 'd3-time-format';
import { scaleLinear, scaleTime } from 'd3-scale';
import { axisLeft, axisTop, axisRight } from 'd3-axis';
import { timeMinute, timeSecond } from 'd3-time';
import { select, mouse, event as d3event } from 'd3-selection';
import { line } from 'd3-shape';
import { zoom, zoomIdentity } from 'd3-zoom';
import { brushY } from 'd3-brush';

const d3 = Object.assign({}, {
  timeParse,
  timeFormat,
  scaleLinear,
  scaleTime,
  axisLeft,
  axisTop,
  axisRight,
  timeMinute,
  mouse,
  select,
  line,
  zoom,
  brushY,
  timeSecond,
  zoomIdentity,
});

/**
 * This class manages the Marey diagram visualization.
 * The data/state stored by this class is kept at the minimum,
 * only the essential information needed to draw it is stored.
 */
export default class MareyDiagram {
  constructor(data, diagGroup, scrollGroup, dims, options, changeCallback) {
    this.data = data;
    this.diagGroup = diagGroup;
    this.scrollGroup = scrollGroup;
    this.dims = dims;
    this.options = options;

    this.initialSetup(changeCallback);
    this.drawTrips();
  }

  /**
   * Initial setup of the visualization, including svg group creation,
   * scales creation, axes and timeline drawing.
   * @param  {Function} changeCallback - Callback for the timeline change event
   */
  initialSetup(changeCallback) {
    this.yAxisTimeFormat = d3.timeFormat('%H:%M');
    this.timelineTimeFormat = d3.timeFormat('%H:%M:%S');

    // Add 10 min offset to improve readability
    this.minTime = d3.timeMinute.offset(this.data.timeBoundaries.first, -10);
    this.maxTime = d3.timeMinute.offset(this.data.timeBoundaries.last, +10);

    // Rectangle that clips the trips, so that when we zoom they don't
    // end up out of the main graph
    this.diagGroup.append('clipPath')
      .attr('id', 'clip-path')
      .append('rect')
      // Use a 5px margin on the sides so that the circles representing the stops
      // are entirely visible
      .attr('x', -5)
      .attr('width', this.dims.marey.innerWidth + 5)
      .attr('height', this.dims.marey.innerHeight);

    // Line generator for the static schedule of a trip
    this.tripLineGenerator = d3.line()
      .x(({ distance }) => this.xScale(distance))
      .y(({ time }) => this.yScale(time));

    this.createScales();
    this.createGroups();
    this.drawXAxis();
    this.drawYAxes();
    this.createTimeline(changeCallback);

    /* eslint global-require: "off" */
    this.zoomBehaviour = d3.zoom()
      .scaleExtent([1, Infinity])
      .extent([[0, 0], [this.dims.marey.innerWidth, this.dims.marey.innerHeight]])
      .translateExtent([[0, 0], [this.dims.marey.innerWidth, this.dims.marey.innerHeight]])
      // We encapsulate this.zoomed in a closure so that we don't lose the "this" context
      .on('zoom', () => { this.zoomed(); });

    this.diagGroup.call(this.zoomBehaviour);

    this.brushBehaviour = d3.brushY()
      .extent([[-20, 0], [0, this.dims.mareyScroll.height]])
      // Same as this.zoomed
      .on('brush end', () => { this.brushed(); });

    this.scrollGroup.append('g')
      .attr('class', 'brush')
      .call(this.brushBehaviour)
      .call(this.brushBehaviour.move, [0, this.yScrollScale.range()[1] / 4]);
  }

  brushed() {
    // Ignore brush-by-zoom
    if (d3event.sourceEvent && d3event.sourceEvent.type === 'zoom') return;
    const selection = d3event.selection || this.yScrollScale.range();
    this.yScale.domain(selection.map(this.yScrollScale.invert, this.yScrollScale));
    this.yLeftAxisG.call(this.yLeftAxis);
    this.yRightAxisG.call(this.yRightAxis);
    this.drawTrips();
    this.diagGroup.call(this.zoomBehaviour.transform, d3.zoomIdentity
      .scale(this.dims.mareyScroll.height / (selection[1] - selection[0]))
      .translate(0, -selection[0]));
    this.lastK = this.dims.mareyScroll.height / (selection[1] - selection[0]);
  }

  zoomed() {
    if (typeof this.lastK === 'undefined') this.lastK = d3event.transform.k;

    if (d3event.sourceEvent) {
      // Ignore zoom-by-brush
      if (['brush', 'end'].includes(d3event.sourceEvent.type)) return;

      if (d3event.sourceEvent.type === 'wheel' && !d3event.sourceEvent.shiftKey) {
        // Panning
        const currentDomain = this.yScale.domain();
        const secondsDomain = (currentDomain[1] - currentDomain[0]) / 1000;
        const step = Math.floor((d3event.sourceEvent.deltaY * secondsDomain) / 1000);
        const newDomain = [
          d3.timeSecond.offset(currentDomain[0], step),
          d3.timeSecond.offset(currentDomain[1], step),
        ];
        const originalDomain = this.yScrollScale.domain();
        if (newDomain[0] >= originalDomain[0] &&
            newDomain[1] <= originalDomain[1]) this.yScale.domain(newDomain);

        this.diagGroup.call(this.zoomBehaviour.transform, d3.zoomIdentity
          .scale(this.lastK)
          .translate(0, -this.yScrollScale(this.yScale.domain()[0])));
      } else {
        // Zooming
        this.lastK = d3event.transform.k;
        this.yScale.domain(d3event.transform.rescaleY(this.yScrollScale).domain());
      }
    }

    this.scrollGroup.select('.brush')
      .call(this.brushBehaviour.move, this.yScale.domain().map(this.yScrollScale));

    this.yLeftAxisG.call(this.yLeftAxis);
    this.yRightAxisG.call(this.yRightAxis);
    this.drawTrips();
  }

  /**
   * Create x and y scales for the visualization, used to draw the axes and the trips
   */
  createScales() {
    this.xScale = d3.scaleLinear()
      .domain([0, this.data.stopsDistances[this.data.stopsDistances.length - 1].distance])
      .range([0, this.dims.marey.innerWidth]);
    this.yScale = d3.scaleTime()
      .domain([this.minTime, this.maxTime])
      .range([0, this.dims.marey.innerHeight]);
    this.yScrollScale = d3.scaleTime()
      .domain([this.minTime, this.maxTime])
      .range([0, this.dims.mareyScroll.height]);
  }

  /**
   * Create the SVG groups containing the axes and the trips
   */
  createGroups() {
    this.yLeftAxisG = this.diagGroup.append('g')
      .attr('class', 'left-axis axis');
    this.yRightAxisG = this.diagGroup.append('g')
      .attr('class', 'right-axis axis')
      .attr('transform', `translate(${this.dims.marey.innerWidth},0)`);
    this.yScrollAxisG = this.scrollGroup.append('g')
      .attr('class', 'scroll-axis axis');
    this.tripsG = this.diagGroup.append('g')
      .attr('class', 'trips')
      .attr('clip-path', 'url(#clip-path)');
    this.xAxisG = this.diagGroup.append('g')
      .attr('class', 'top-axis axis');
  }

  /**
   * Vertical axes drawing, left and right
   */
  drawYAxes() {
    this.yLeftAxis = d3.axisLeft(this.yScale)
      .ticks(20)
      .tickFormat(this.yAxisTimeFormat);

    this.yRightAxis = d3.axisRight(this.yScale)
      .ticks(20)
      .tickFormat(this.yAxisTimeFormat);

    this.yScrollAxis = d3.axisRight(this.yScrollScale)
      .ticks(20)
      .tickFormat(this.yAxisTimeFormat);

    this.yLeftAxisG.call(this.yLeftAxis);
    this.yRightAxisG.call(this.yRightAxis);
    this.yScrollAxisG.call(this.yScrollAxis);
  }

  /**
   * Horizontal axis drawing
   */
  drawXAxis() {
    this.xAxis = d3.axisTop(this.xScale)
      .tickSize(-this.dims.marey.innerHeight)
      .tickValues(this.data.stopsDistances.map(({ distance }) => distance))
      .tickFormat((_, index) => this.data.stopsDistances[index].stop.code);

    this.xAxisG.call(this.xAxis);

    this.xAxisG.selectAll('text')
      .attr('y', 0)
      .attr('x', 5)
      .attr('dy', '.35em');
  }

  /**
   * Create the horizontal line representing the timeline
   * and make it move when the mouse is hovered in the canvas
   * @param  {Function} changeCallback - Callback to trigger when the timeline is moved
   */
  createTimeline(changeCallback) {
    // Initial position of the timeline
    const initialTimelineYpos = this.yScale(this.minTime);

    // Timeline group creation
    const timeline = this.diagGroup.append('g')
      .attr('class', 'timeline')
      .attr('transform', `translate(0,${initialTimelineYpos})`);

    // Horizontal line
    timeline.append('line')
      .attr('x1', 0)
      .attr('x2', this.dims.marey.innerWidth);

    // Label with the time
    timeline.append('text')
      .text(this.timelineTimeFormat(this.minTime))
      .attr('x', 5)
      .attr('y', -5);

    // Create overlay to handle timeline movement with mouse
    this.diagGroup.append('rect')
      .attr('id', 'mouse-move-overlay')
      .attr('width', this.dims.marey.innerWidth)
      .attr('height', this.dims.marey.innerHeight)
      .on('mousemove', () => {
        // d3.mouse wants a DOM element, so get it by its ID
        const overlay = document.getElementById('mouse-move-overlay');
        // Get the mouse position relative to the overlay
        const yPos = d3.mouse(overlay)[1];
        // Get the time corresponding to the actual mouse position
        // and format it
        const time = this.yScale.invert(yPos);

        changeCallback(time);

        // Update the y position of the timeline group
        d3.select('g.timeline').attr('transform', `translate(0,${yPos})`);
        // Update the text showing the time
        d3.select('g.timeline text').text(this.timelineTimeFormat(time));
      });
  }

  /**
   * Given a list of vehicle positions, get the links between them
   * @param  {Array.<{time: Date, distance: number, status: string}>} positions - Positions info
   * @return {Array.<{timeA: Date, timeB: Date,
   *           distanceA: number, distanceB: number,
   *           status: string, prognosed: boolean}>} - Positions links information
   */
  static getPositionLinks(positions) {
    const posLinks = [];
    for (let index = 0; index < positions.length - 1; index += 1) {
      const posA = positions[index];
      const posB = positions[index + 1];
      const timeA = posA.time;
      const timeB = posB.time;
      const distanceA = posA.distance;
      const distanceB = posB.distance;

      const prognosed = posA.prognosed || posB.prognosed;

      posLinks.push({ timeA, timeB, distanceA, distanceB, status: posA.status, prognosed });
    }

    return posLinks;
  }

  /**
   * Draw the trips on the diagram
   */
  drawTrips() {
    // Trip selection
    const tripsSel = this.tripsG.selectAll('g.trip')
      .data(
        this.data.trips.filter((trip) => {
          const [minShownTime, maxShownTime] = this.yScale.domain();
          const { first: firstTripTime, last: lastTripTime } = trip.timeBoundaries;

          return (firstTripTime < minShownTime && lastTripTime > maxShownTime) ||
            (minShownTime < firstTripTime && firstTripTime < maxShownTime) ||
            (minShownTime < lastTripTime && lastTripTime < maxShownTime);
        }),
        ({ code }) => code,
      );

    // Trip exit
    tripsSel.exit().remove();

    // Trip enter
    const tripsEnterSel = tripsSel.enter().append('g')
      .attr('class', 'trip')
      .attr('data-trip-code', ({ code }) => code);

    // Trip enter > path
    tripsEnterSel
      .append('path')
      .merge(tripsSel.select('path'))
      .attr('d', ({ schedule }) => this.tripLineGenerator(schedule));

    // Trip enter > circle selection
    const tripsScheduledStopsSel = tripsEnterSel.merge(tripsSel)
      .selectAll('circle.scheduledStop')
      .data(({ schedule }) => schedule);

    // Trip enter > circle
    tripsScheduledStopsSel.enter()
      .append('circle')
      .attr('class', 'scheduledStop')
      .attr('r', '2')
      .attr('cx', ({ distance }) => this.xScale(distance))
      .merge(tripsScheduledStopsSel)
      .attr('cy', ({ time }) => this.yScale(time));

    this.tripsG.selectAll('circle.scheduledStop')
      .attr('cy', ({ time }) => this.yScale(time));

    // Trip enter > vehicle selection
    const vehiclesSel = tripsSel.selectAll('g.vehicle')
      .data(({ vehicles }) => vehicles, ({ vehicleNumber }) => vehicleNumber);

    // Trip > vehicle exit
    vehiclesSel.exit().remove();

    // Trip > vehicle enter,
    const vehiclesEnterSel = vehiclesSel.enter().append('g')
      .attr('class', 'vehicle')
      .attr('data-vehicle-n', ({ vehicleNumber }) => vehicleNumber);

    // Trip > vehicle enter + update
    const vehiclesEnterUpdateSel = vehiclesSel.merge(vehiclesEnterSel);

    // Trip > vehicle enter + update > circle
    const vehiclesPosSel = vehiclesEnterUpdateSel
      .selectAll('circle.position')
      .data(({ positions }) => positions, ({ index }) => index);

    // Trip > vehicle > circle enter
    vehiclesSel.selectAll('circle.position').enter()
      .append('circle')
      .attr('class', ({ status, prognosed }) => `position ${status} ${prognosed ? 'prognosed' : ''}`)
      .attr('r', '1')
      // Trip > vehicle > circle enter + update
      .merge(vehiclesPosSel)
      .attr('cx', ({ distance }) => this.xScale(distance))
      .attr('cy', ({ time }) => this.yScale(time));

    // Trip > vehicle > line
    const vehiclesPosLinksSel = vehiclesEnterUpdateSel.selectAll('line.pos-link')
      .data(({ positions }) => MareyDiagram.getPositionLinks(positions));

    // Trip > vehicle > line enter
    vehiclesPosLinksSel.enter()
      .append('line')
      .attr('class', ({ status, prognosed }) => `pos-link ${status} ${prognosed ? 'prognosed' : ''}`)
      // Trip > vehicle > line enter + update
      .merge(vehiclesPosLinksSel)
      .attr('x1', ({ distanceA }) => this.xScale(distanceA))
      .attr('x2', ({ distanceB }) => this.xScale(distanceB))
      .attr('y1', ({ timeA }) => this.yScale(timeA))
      .attr('y2', ({ timeB }) => this.yScale(timeB));
  }
}
