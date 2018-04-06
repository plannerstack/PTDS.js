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

    // Overlay to listen to mouse movement (and update the timeline)
    // and listen to zoom/pan events
    this.overlay = this.diagGroup.append('rect')
      .attr('class', 'overlay')
      .attr('width', this.dims.marey.innerWidth)
      .attr('height', this.dims.marey.innerHeight);

    this.selectedStop = null;
    this.createTimeline(changeCallback);
    this.zoomAndBrushSetup();
  }

  /**
   * Time formatter for the ticks of the y axis
   * By default formats the time in HH:MM but when zoomed in
   * so that the time interval shown is smaller than 15 minutes
   * it formats it in HH:MM:SS, i.e. displaying also the seconds.
   * @return {Function} - Time formatter
   */
  get yAxisTimeFormatter() {
    const yDomain = this.yScale.domain();
    const secondsInDomain = (yDomain[1] - yDomain[0]) / 1000;
    if (secondsInDomain < 15 * 60) return d3.timeFormat('%H:%M:%S');
    return d3.timeFormat('%H:%M');
  }

  /**
   * Set up the zoom and brush behaviours
   */
  zoomAndBrushSetup() {
    this.zoomBehaviour = d3.zoom()
      .scaleExtent([1, 2000])
      .extent([[0, 0], [this.dims.marey.innerWidth, this.dims.marey.innerHeight]])
      .translateExtent([[0, 0], [this.dims.marey.innerWidth, this.dims.marey.innerHeight]])
      // We encapsulate this.zoomed in a closure so that we don't lose the "this" context
      .on('zoom', () => { this.zoomed(); });

    this.overlay.call(this.zoomBehaviour);

    this.brushBehaviour = d3.brushY()
      .extent([[-20, 0], [0, this.dims.mareyScroll.height]])
      // Same as above
      .on('brush end', () => { this.brushed(); });

    this.scrollGroup
      .call(this.brushBehaviour)
      .call(this.brushBehaviour.move, [0, this.yScrollScale.range()[1] / 4]);
  }

  /**
   * Handle the brush selection
   */
  brushed() {
    // When the zoom event is triggered, the zoom handler
    // triggers a brush event to sync the two parts,
    // but we don't want to handle the brush in that case.
    if (d3event.sourceEvent && d3event.sourceEvent.type === 'zoom') return;

    // Get the brush selection
    const selection = d3event.selection || this.yScrollScale.range();

    // Make it impossible to select a null extent
    if (selection[0] === selection[1]) {
      this.scrollGroup.call(
        this.brushBehaviour.move,
        [selection[0], selection[0] + 1],
      );
      return;
    }

    // Update the marey y scale domain
    this.yScale.domain(selection.map(this.yScrollScale.invert));

    // Update marey axes
    this.refreshAxes();

    // Update the trips
    this.drawTrips();

    // Sync the zoom transform
    const zoomTransform = d3.zoomIdentity
      .scale(this.dims.mareyScroll.height / (selection[1] - selection[0]))
      .translate(0, -selection[0]);
    this.overlay.call(this.zoomBehaviour.transform, zoomTransform);

    // Update the transform scale
    this.lastK = this.dims.mareyScroll.height / (selection[1] - selection[0]);
  }

  /**
   * Refresh the axes after changing the scale and/or the ticks
   */
  refreshAxes() {
    this.yLeftAxis.tickFormat(this.yAxisTimeFormatter);
    this.yRightAxis.tickFormat(this.yAxisTimeFormatter);
    this.yLeftAxisG.call(this.yLeftAxis.scale(this.yScale));
    this.yRightAxisG.call(this.yRightAxis.scale(this.yScale));
  }

  /**
   * Handle the zoom/pan events on the diagram
   */
  zoomed() {
    if (d3event.sourceEvent) {
      // When the brush event is triggered, the brush handler
      // triggers a zoom event to sync the two parts,
      // but we don't want to handle the zoom in that case.
      if (['brush', 'end'].includes(d3event.sourceEvent.type)) return;

      // If the event is triggered by the scroll of the mouse wheel and the shift key
      // is not pressed, we interpret it as PAN
      if (d3event.sourceEvent.type === 'wheel' && !d3event.sourceEvent.shiftKey) {
        // Get the current domain in the marey diagram y axis
        const selectedDomain = this.yScale.domain();
        // Compute number of seconds in the selected domain
        const secondsInSelectedDomain = (selectedDomain[1] - selectedDomain[0]) / 1000;
        // Get the delta (= amount of scroll) of the event
        let delta = d3event.sourceEvent.deltaY;
        // If deltaMode = 1, the delta amount is given in lines and not pixels. (Firefox specific)
        // The conversion factor between lines and pixels is roughly 18. (1 line = 18 pixels)
        delta *= d3event.sourceEvent.deltaMode === 1 ? 18 : 1;
        // Constant setting the scroll speed. The bigger the constant, the faster.
        const scrollFactor = 0.001;
        // Compute the number of seconds by which the selected domain will be panned/moved
        const step = Math.floor(delta * secondsInSelectedDomain * scrollFactor);
        // The tentative new selected domain
        const newDomain = [
          d3.timeSecond.offset(selectedDomain[0], step),
          d3.timeSecond.offset(selectedDomain[1], step),
        ];

        // The original domain, i.e. first and last times in the dataset
        const originalDomain = this.yScrollScale.domain();

        // If we're trying to pan back in time and we're already on the upper border,
        // or forward in time and we're at the lower border, stop
        if ((newDomain[0] === originalDomain[0] && delta < 0) ||
            (newDomain[1] === originalDomain[1] && delta > 0)) return;

        // If the new domain is outside of the upper bound, set its start at the upper border
        if (newDomain[0] < originalDomain[0]) {
          [newDomain[0]] = originalDomain;
          newDomain[1] = d3.timeSecond.offset(newDomain[0], secondsInSelectedDomain);
        }
        // If the new domain is outside of the lower bound, set its start at the lower border
        if (newDomain[1] > originalDomain[1]) {
          [, newDomain[1]] = originalDomain;
          newDomain[0] = d3.timeSecond.offset(newDomain[1], -secondsInSelectedDomain);
        }

        // Update the selected domain
        this.yScale.domain(newDomain);

        // Update the zoom transform information. By default mouse wheel is used for zoom
        // so the transform will be updated by d3 as if we zoomed into the graph. Since
        // we are instead mapping the mouse wheel event to the panning, we have to manually
        // force update the zoom transform information.
        // The scale does not change (we're only panning, not zooming) and we therefore force
        // to the scale value the last known one (lastK).
        const zoomTransform = d3.zoomIdentity
          .scale(this.lastK)
          .translate(0, -this.yScrollScale(newDomain[0]));
        this.overlay.call(this.zoomBehaviour.transform, zoomTransform);
      } else {
        // If shift key is pressed, ZOOM.
        // Update the last known scale K value
        this.lastK = d3event.transform.k;
        this.yScale = d3event.transform.rescaleY(this.yScrollScale);
      }
    }

    // Update the brush selection
    this.scrollGroup.call(
      this.brushBehaviour.move,
      this.yScale.domain().map(this.yScrollScale),
    );

    // Update the marey y axes
    this.refreshAxes();

    // Update the trips
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
   * Create the SVG groups for the elements of the visualization.
   * In SVG the order of painting determines the "z-index" of the elements
   * so by changing the order of group creation we can adjust their "z-index".
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
    this.timelineG = this.diagGroup.append('g')
      .attr('class', 'timeline');
  }

  /**
   * Vertical axes drawing, left and right
   */
  drawYAxes() {
    this.yLeftAxis = d3.axisLeft(this.yScale)
      .ticks(20)
      .tickFormat(this.yAxisTimeFormatter);

    this.yRightAxis = d3.axisRight(this.yScale)
      .ticks(20)
      .tickFormat(this.yAxisTimeFormatter);

    this.yScrollAxis = d3.axisRight(this.yScrollScale)
      .ticks(20)
      .tickFormat(this.yAxisTimeFormatter);

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

    this.xAxisG.selectAll('.tick')
      .data(this.data.stopsDistances.map(({ stop }) => stop))
      .attr('data-stop-code', ({ code }) => code);

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

    // Timeline initial position
    this.timelineG.attr('transform', `translate(0,${initialTimelineYpos})`);

    // Horizontal line
    this.timelineG.append('line')
      .attr('x1', 0)
      .attr('x2', this.dims.marey.innerWidth);

    // Label with the time
    this.timelineG.append('text')
      .text(this.timelineTimeFormat(this.minTime))
      .attr('x', 5)
      .attr('y', -5);

    // Register mouse movement listener on overlay
    this.overlay.on('mousemove', () => {
      // Get the mouse position relative to the overlay
      // Using a closure we maintain the "this" context as the class instance,
      // but we don't have the DOM element reference so we have to get that manually.
      const [xPos, yPos] = d3.mouse(this.overlay.node());
      const pixelsRadiusNeighborhood = 2;

      let aroundAStop = false;
      for (const { stop, distance } of this.data.stopsDistances) {
        if (this.xScale(distance) - pixelsRadiusNeighborhood <= xPos &&
            this.xScale(distance) + pixelsRadiusNeighborhood >= xPos) {
          if (this.selectedStop === null || this.selectedStop !== stop.code) {
            this.selectedStop = stop.code;
            this.xAxisG.select(`g.tick[data-stop-code='${stop.code}']`)
              .classed('selected', true);
          }
          aroundAStop = true;
          break;
        }
      }

      if (!aroundAStop && this.selectedStop !== null) {
        this.xAxisG.selectAll('.tick').classed('selected', false);
        this.selectedStop = null;
      }

      // Get the time corresponding to the actual mouse position
      // and format it
      const time = this.yScale.invert(yPos);

      changeCallback(time);

      // Update the y position of the timeline group
      this.timelineG.attr('transform', `translate(0,${yPos})`);
      // Update the text showing the time
      this.timelineG.select('text').text(this.timelineTimeFormat(time));
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
    // Get the trips that are visible in the currently selected domain.
    const tripsInSelectedDomain = this.data.trips.filter((trip) => {
      const [minShownTime, maxShownTime] = this.yScale.domain();
      const { first: firstTripTime, last: lastTripTime } = trip.timeBoundaries;

      return (firstTripTime < minShownTime && lastTripTime > maxShownTime) ||
        (minShownTime < firstTripTime && firstTripTime < maxShownTime) ||
        (minShownTime < lastTripTime && lastTripTime < maxShownTime);
    });

    // Trip selection
    const tripsSel = this.tripsG.selectAll('g.trip')
      .data(tripsInSelectedDomain, ({ code }) => code);

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
    // const vehiclesPosSel = vehiclesEnterUpdateSel
    //   .selectAll('circle.position')
    //   .data(({ positions }) => positions);

    // vehiclesPosSel.enter()
    //   .append('circle')
    //   .attr('class', ({ status, prognosed }) =>
    //     `position ${status} ${prognosed ? 'prognosed' : ''}`)
    //   .attr('r', '1.5')
    //   .attr('cx', ({ distance }) => this.xScale(distance))
    //   // Trip > vehicle > circle enter + update
    //   .merge(vehiclesPosSel)
    //   .attr('cy', ({ time }) => this.yScale(time));

    // Trip > vehicle > line
    const vehiclesPosLinksSel = vehiclesEnterUpdateSel.selectAll('line.pos-link')
      .data(({ positions }) => MareyDiagram.getPositionLinks(positions));

    // Trip > vehicle > line enter
    vehiclesPosLinksSel.enter()
      .append('line')
      .attr('class', ({ status, prognosed }) => `pos-link ${status} ${prognosed ? 'prognosed' : ''}`)
      // Trip > vehicle > line enter + update
      .attr('x1', ({ distanceA }) => this.xScale(distanceA))
      .attr('x2', ({ distanceB }) => this.xScale(distanceB))
      .merge(vehiclesPosLinksSel)
      .attr('y1', ({ timeA }) => this.yScale(timeA))
      .attr('y2', ({ timeB }) => this.yScale(timeB));
  }
}
