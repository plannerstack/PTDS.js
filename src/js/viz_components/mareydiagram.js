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

    // Overlay to listen to mouse movement (and update the timeline)
    // and listen to zoom/pan events
    this.overlay = this.diagGroup.append('rect')
      .attr('class', 'overlay')
      .attr('width', this.dims.marey.innerWidth)
      .attr('height', this.dims.marey.innerHeight);

    this.createScales();
    this.createGroups();
    this.drawXAxis();
    this.drawYAxes();

    this.createTimeline(changeCallback);
    this.zoomAndBrushSetup();
  }

  /**
   * Numer of seconds in the current domain of the Marey diagram
   * @return {Number} - Seconds in current domain of the Marey diagram
   */
  get secondsInDomain() {
    const yDomain = this.yScale.domain();
    return (yDomain[1] - yDomain[0]) / 1000;
  }

  /**
   * Time formatter for the ticks of the y axis
   * By default formats the time in HH:MM but when zoomed in
   * so that the time interval shown is smaller than 15 minutes
   * it formats it in HH:MM:SS, i.e. displaying also the seconds.
   * @return {Function} - Time formatter
   */
  get yAxisTimeFormatter() {
    if (this.secondsInDomain < 15 * 60) return d3.timeFormat('%H:%M:%S');
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

    this.diagGroup.call(this.zoomBehaviour);

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
    this.diagGroup.call(this.zoomBehaviour.transform, zoomTransform);

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
        this.diagGroup.call(this.zoomBehaviour.transform, zoomTransform);
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
    this.xAxisG = this.diagGroup.append('g')
      .attr('class', 'top-axis axis');
    this.tripsG = this.diagGroup.append('g')
      .attr('class', 'trips')
      .attr('clip-path', 'url(#clip-path)');
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

    // Enhance vertical lines representing stops adding the stop code as attribute
    // to the SVG element and adding the "selected" CSS class to them when the mouse
    // cursor is positioned over
    this.xAxisG.selectAll('.tick')
      .data(this.data.stopsDistances.map(({ stop }) => stop))
      .attr('data-stop-code', ({ code }) => code)
      .on('mouseover', function f(stop) {
        const stopAreaCode = stop.area.code;
        d3.select(`#map g.stopArea[data-stop-area-code='${stopAreaCode}'] circle`).attr('r', 3);
        d3.select(this).classed('selected', true);
      })
      .on('mouseout', function f(stop) {
        const stopAreaCode = stop.area.code;
        d3.select(`#map g.stopArea[data-stop-area-code='${stopAreaCode}'] circle`).attr('r', 1);
        d3.select(this).classed('selected', false);
      });

    this.xAxisG.selectAll('text')
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
      .attr('x2', this.dims.marey.innerWidth)
      // Keep the line slightly below the mouse cursor so that it doesn't capture
      // all the mouse events, passing them to the elements below
      .attr('y1', 1)
      .attr('y2', 1);

    // Label with the time
    this.timelineG.append('text')
      .text(this.timelineTimeFormat(this.minTime))
      .attr('x', 5)
      .attr('y', -5);

    // Register mouse movement listener.
    // Normally we would register the listener on the overlay, which
    // is the area that contains the timeline and the trips.
    // Doing that, though, means that elements with a "z-index" greater than
    // the overlay will get first the movement trigger, so that this handler would not be called.
    // Therefore we register the listener on the main group with all the SVG elements.
    this.diagGroup.on('mousemove', () => {
      // Get the mouse position relative to the overlay
      // Using a closure we maintain the "this" context as the class instance,
      // but we don't have the DOM element reference so we have to get that manually.
      const [, yPos] = d3.mouse(this.overlay.node());
      // Since this handler is triggered also when the mouse cursor is not in the overlay,
      // we need to check that we are in it. It usually happens when we move the mouse
      // over the labels of the top axis, therefore we correct for that case.
      if (yPos < 0) return;

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
   * Given a list of vehicle positions, get the links between them.
   * Basing on the current domain of the diagram, it approximates the positions
   * to reduce the amount of links to be drawn.
   * @param  {Array.<{time: Date, distance: number, status: string}>} positions - Positions info
   * @return {Array.<{timeA: Date, timeB: Date,
   *           distanceA: number, distanceB: number,
   *           status: string, prognosed: boolean}>} - Positions links information
   */
  getPositionLinks(positions) {
    // minSecondsDelta determines the approximation by estabilishing a minimum
    // number of seconds between two positions to be drawn
    let minSecondsDelta;
    if (this.secondsInDomain > 120 * 60) {
      minSecondsDelta = 120;
    } else if (this.secondsInDomain > 60 * 60) {
      minSecondsDelta = 30;
    } else minSecondsDelta = 0;

    const posLinks = [];
    let index = 0;

    while (index < positions.length - 1) {
      const posA = positions[index];
      let posB = positions[index + 1];
      const timeA = posA.time;
      let timeB = posB.time;

      // If the current "second position" of the link is less than minSecondsDelta seconds
      // apart from the first one, skip it and move to the next "second position".
      // Only if the first and second position of the segment have the same status,
      // so that if a vehicle changed its status we don't skip the position
      while (index < positions.length - 2 &&
             posA.status === posB.status &&
             timeB - timeA < minSecondsDelta * 1000) {
        index += 1;
        posB = positions[index + 1];
        timeB = posB.time;
      }

      const distanceA = posA.distance;
      const distanceB = posB.distance;
      const prognosed = posA.prognosed || posB.prognosed;

      posLinks.push({ timeA, timeB, distanceA, distanceB, status: posA.status, prognosed });
      index += 1;
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

    // Get the overlay element from the class instance because we'll lose the "this" reference later
    const { overlay } = this;

    // Trip enter
    const tripsEnterSel = tripsSel.enter().append('g')
      .attr('class', 'trip')
      .attr('data-trip-code', ({ code }) => code)
      .on('mouseover', function f(trip) {
        // Get the SVG g element corresponding to this trip
        const tripSel = d3.select(this);
        // Get the current mouse position
        const [xPos, yPos] = d3.mouse(overlay.node());
        // Add label with the code of the trip next to the mouse cursor
        tripSel.append('text')
          .attr('class', 'tripLabel')
          .attr('x', xPos)
          .attr('y', yPos)
          .attr('dy', -10)
          .text(({ code }) => code);
        // Add 'selected' class to the trip SVG group
        tripSel.classed('selected', true);
        tripSel.selectAll('circle.scheduledStop').attr('r', 3);
        // In the map, highlight the vehicle
        d3.select(`#map g.trip[data-code='${trip.code}'] circle`).attr('r', 6);
      })
      .on('mouseout', function f(trip) {
        // Similarly as above
        const tripSel = d3.select(this);
        tripSel.select('text.tripLabel').remove();
        tripSel.classed('selected', false);
        tripSel.selectAll('circle.scheduledStop').attr('r', 2);
        d3.select(`#map g.trip[data-code='${trip.code}'] circle`).attr('r', 3);
      });

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
    const vehiclesPosSel = vehiclesEnterUpdateSel
      .selectAll('circle.position')
      // Draw the dots representing the positions only at the maximum zoom level
      .data(({ positions }) => (this.secondsInDomain <= 60 * 60 ? positions : []));

    vehiclesPosSel.exit().remove();

    vehiclesPosSel.enter()
      .append('circle')
      .attr('class', ({ status, prognosed }) =>
        `position ${status} ${prognosed ? 'prognosed' : ''}`)
      .attr('r', '1.5')
      .attr('cx', ({ distance }) => this.xScale(distance))
      // Trip > vehicle > circle enter + update
      .merge(vehiclesPosSel)
      .attr('cy', ({ time }) => this.yScale(time));

    // Trip > vehicle > line
    const vehiclesPosLinksSel = vehiclesEnterUpdateSel.selectAll('line.pos-link')
      .data(({ positions }) => this.getPositionLinks(positions));

    vehiclesPosLinksSel.exit().remove();

    // Trip > vehicle > line enter
    vehiclesPosLinksSel.enter()
      .append('line')
      // Trip > vehicle > line enter + update
      .merge(vehiclesPosLinksSel)
      .attr('class', ({ status, prognosed }) => `pos-link ${status} ${prognosed ? 'prognosed' : ''}`)
      .attr('x1', ({ distanceA }) => this.xScale(distanceA))
      .attr('x2', ({ distanceB }) => this.xScale(distanceB))
      .attr('y1', ({ timeA }) => this.yScale(timeA))
      .attr('y2', ({ timeB }) => this.yScale(timeB));
  }
}
