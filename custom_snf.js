/*--Owl Carousel--*/
/**
 * Owl carousel
 * @version 2.1.6
 * @author Bartosz Wojciechowski
 * @author David Deutsch
 * @license The MIT License (MIT)
 * @todo Lazy Load Icon
 * @todo prevent animationend bubling
 * @todo itemsScaleUp
 * @todo Test Zepto
 * @todo stagePadding calculate wrong active classes
 */
;(function($, window, document, undefined) {

    /**
     * Creates a carousel.
     * @class The Owl Carousel.
     * @public
     * @param {HTMLElement|jQuery} element - The element to create the carousel for.
     * @param {Object} [options] - The options
     */
    function Owl(element, options) {

        /**
         * Current settings for the carousel.
         * @public
         */
        this.settings = null;

        /**
         * Current options set by the caller including defaults.
         * @public
         */
        this.options = $.extend({}, Owl.Defaults, options);

        /**
         * Plugin element.
         * @public
         */
        this.$element = $(element);

        /**
         * Proxied event handlers.
         * @protected
         */
        this._handlers = {};

        /**
         * References to the running plugins of this carousel.
         * @protected
         */
        this._plugins = {};

        /**
         * Currently suppressed events to prevent them from beeing retriggered.
         * @protected
         */
        this._supress = {};

        /**
         * Absolute current position.
         * @protected
         */
        this._current = null;

        /**
         * Animation speed in milliseconds.
         * @protected
         */
        this._speed = null;

        /**
         * Coordinates of all items in pixel.
         * @todo The name of this member is missleading.
         * @protected
         */
        this._coordinates = [];

        /**
         * Current breakpoint.
         * @todo Real media queries would be nice.
         * @protected
         */
        this._breakpoint = null;

        /**
         * Current width of the plugin element.
         */
        this._width = null;

        /**
         * All real items.
         * @protected
         */
        this._items = [];

        /**
         * All cloned items.
         * @protected
         */
        this._clones = [];

        /**
         * Merge values of all items.
         * @todo Maybe this could be part of a plugin.
         * @protected
         */
        this._mergers = [];

        /**
         * Widths of all items.
         */
        this._widths = [];

        /**
         * Invalidated parts within the update process.
         * @protected
         */
        this._invalidated = {};

        /**
         * Ordered list of workers for the update process.
         * @protected
         */
        this._pipe = [];

        /**
         * Current state information for the drag operation.
         * @todo #261
         * @protected
         */
        this._drag = {
            time: null,
            target: null,
            pointer: null,
            stage: {
                start: null,
                current: null
            },
            direction: null
        };

        /**
         * Current state information and their tags.
         * @type {Object}
         * @protected
         */
        this._states = {
            current: {},
            tags: {
                'initializing': [ 'busy' ],
                'animating': [ 'busy' ],
                'dragging': [ 'interacting' ]
            }
        };

        $.each([ 'onResize', 'onThrottledResize' ], $.proxy(function(i, handler) {
            this._handlers[handler] = $.proxy(this[handler], this);
        }, this));

        $.each(Owl.Plugins, $.proxy(function(key, plugin) {
            this._plugins[key.charAt(0).toLowerCase() + key.slice(1)]
                = new plugin(this);
        }, this));

        $.each(Owl.Workers, $.proxy(function(priority, worker) {
            this._pipe.push({
                'filter': worker.filter,
                'run': $.proxy(worker.run, this)
            });
        }, this));

        this.setup();
        this.initialize();
    }

    /**
     * Default options for the carousel.
     * @public
     */
    Owl.Defaults = {
        items: 3,
        loop: false,
        center: false,
        rewind: false,

        mouseDrag: true,
        touchDrag: true,
        pullDrag: true,
        freeDrag: false,

        margin: 0,
        stagePadding: 0,

        merge: false,
        mergeFit: true,
        autoWidth: false,

        startPosition: 0,
        rtl: false,

        smartSpeed: 250,
        fluidSpeed: false,
        dragEndSpeed: false,

        responsive: {},
        responsiveRefreshRate: 200,
        responsiveBaseElement: window,

        fallbackEasing: 'swing',

        info: false,

        nestedItemSelector: false,
        itemElement: 'div',
        stageElement: 'div',

        refreshClass: 'owl-refresh',
        loadedClass: 'owl-loaded',
        loadingClass: 'owl-loading',
        rtlClass: 'owl-rtl',
        responsiveClass: 'owl-responsive',
        dragClass: 'owl-drag',
        itemClass: 'owl-item',
        stageClass: 'owl-stage',
        stageOuterClass: 'owl-stage-outer',
        grabClass: 'owl-grab'
    };

    /**
     * Enumeration for width.
     * @public
     * @readonly
     * @enum {String}
     */
    Owl.Width = {
        Default: 'default',
        Inner: 'inner',
        Outer: 'outer'
    };

    /**
     * Enumeration for types.
     * @public
     * @readonly
     * @enum {String}
     */
    Owl.Type = {
        Event: 'event',
        State: 'state'
    };

    /**
     * Contains all registered plugins.
     * @public
     */
    Owl.Plugins = {};

    /**
     * List of workers involved in the update process.
     */
    Owl.Workers = [ {
        filter: [ 'width', 'settings' ],
        run: function() {
            this._width = this.$element.width();
        }
    }, {
        filter: [ 'width', 'items', 'settings' ],
        run: function(cache) {
            cache.current = this._items && this._items[this.relative(this._current)];
        }
    }, {
        filter: [ 'items', 'settings' ],
        run: function() {
            this.$stage.children('.cloned').remove();
        }
    }, {
        filter: [ 'width', 'items', 'settings' ],
        run: function(cache) {
            var margin = this.settings.margin || '',
                grid = !this.settings.autoWidth,
                rtl = this.settings.rtl,
                css = {
                    'width': 'auto',
                    'margin-left': rtl ? margin : '',
                    'margin-right': rtl ? '' : margin
                };

            !grid && this.$stage.children().css(css);

            cache.css = css;
        }
    }, {
        filter: [ 'width', 'items', 'settings' ],
        run: function(cache) {
            var width = (this.width() / this.settings.items).toFixed(3) - this.settings.margin,
                merge = null,
                iterator = this._items.length,
                grid = !this.settings.autoWidth,
                widths = [];

            cache.items = {
                merge: false,
                width: width
            };

            while (iterator--) {
                merge = this._mergers[iterator];
                merge = this.settings.mergeFit && Math.min(merge, this.settings.items) || merge;

                cache.items.merge = merge > 1 || cache.items.merge;

                widths[iterator] = !grid ? this._items[iterator].width() : width * merge;
            }

            this._widths = widths;
        }
    }, {
        filter: [ 'items', 'settings' ],
        run: function() {
            var clones = [],
                items = this._items,
                settings = this.settings,
                // TODO: Should be computed from number of min width items in stage
                view = Math.max(settings.items * 2, 4),
                size = Math.ceil(items.length / 2) * 2,
                repeat = settings.loop && items.length ? settings.rewind ? view : Math.max(view, size) : 0,
                append = '',
                prepend = '';

            repeat /= 2;

            while (repeat--) {
                // Switch to only using appended clones
                clones.push(this.normalize(clones.length / 2, true));
                append = append + items[clones[clones.length - 1]][0].outerHTML;
                clones.push(this.normalize(items.length - 1 - (clones.length - 1) / 2, true));
                prepend = items[clones[clones.length - 1]][0].outerHTML + prepend;
            }

            this._clones = clones;

            $(append).addClass('cloned').appendTo(this.$stage);
            $(prepend).addClass('cloned').prependTo(this.$stage);
        }
    }, {
        filter: [ 'width', 'items', 'settings' ],
        run: function() {
            var rtl = this.settings.rtl ? 1 : -1,
                size = this._clones.length + this._items.length,
                iterator = -1,
                previous = 0,
                current = 0,
                coordinates = [];

            while (++iterator < size) {
                previous = coordinates[iterator - 1] || 0;
                current = this._widths[this.relative(iterator)] + this.settings.margin;
                coordinates.push(previous + current * rtl);
            }

            this._coordinates = coordinates;
        }
    }, {
        filter: [ 'width', 'items', 'settings' ],
        run: function() {
            var padding = this.settings.stagePadding,
                coordinates = this._coordinates,
                css = {
                    'width': Math.ceil(Math.abs(coordinates[coordinates.length - 1])) + padding * 2,
                    'padding-left': padding || '',
                    'padding-right': padding || ''
                };

            this.$stage.css(css);
        }
    }, {
        filter: [ 'width', 'items', 'settings' ],
        run: function(cache) {
            var iterator = this._coordinates.length,
                grid = !this.settings.autoWidth,
                items = this.$stage.children();

            if (grid && cache.items.merge) {
                while (iterator--) {
                    cache.css.width = this._widths[this.relative(iterator)];
                    items.eq(iterator).css(cache.css);
                }
            } else if (grid) {
                cache.css.width = cache.items.width;
                items.css(cache.css);
            }
        }
    }, {
        filter: [ 'items' ],
        run: function() {
            this._coordinates.length < 1 && this.$stage.removeAttr('style');
        }
    }, {
        filter: [ 'width', 'items', 'settings' ],
        run: function(cache) {
            cache.current = cache.current ? this.$stage.children().index(cache.current) : 0;
            cache.current = Math.max(this.minimum(), Math.min(this.maximum(), cache.current));
            this.reset(cache.current);
        }
    }, {
        filter: [ 'position' ],
        run: function() {
            this.animate(this.coordinates(this._current));
        }
    }, {
        filter: [ 'width', 'position', 'items', 'settings' ],
        run: function() {
            var rtl = this.settings.rtl ? 1 : -1,
                padding = this.settings.stagePadding * 2,
                begin = this.coordinates(this.current()) + padding,
                end = begin + this.width() * rtl,
                inner, outer, matches = [], i, n;

            for (i = 0, n = this._coordinates.length; i < n; i++) {
                inner = this._coordinates[i - 1] || 0;
                outer = Math.abs(this._coordinates[i]) + padding * rtl;

                if ((this.op(inner, '<=', begin) && (this.op(inner, '>', end)))
                    || (this.op(outer, '<', begin) && this.op(outer, '>', end))) {
                    matches.push(i);
                }
            }

            this.$stage.children('.active').removeClass('active');
            this.$stage.children(':eq(' + matches.join('), :eq(') + ')').addClass('active');

            if (this.settings.center) {
                this.$stage.children('.center').removeClass('center');
                this.$stage.children().eq(this.current()).addClass('center');
            }
        }
    } ];

    /**
     * Initializes the carousel.
     * @protected
     */
    Owl.prototype.initialize = function() {
        this.enter('initializing');
        this.trigger('initialize');

        this.$element.toggleClass(this.settings.rtlClass, this.settings.rtl);

        if (this.settings.autoWidth && !this.is('pre-loading')) {
            var imgs, nestedSelector, width;
            imgs = this.$element.find('img');
            nestedSelector = this.settings.nestedItemSelector ? '.' + this.settings.nestedItemSelector : undefined;
            width = this.$element.children(nestedSelector).width();

            if (imgs.length && width <= 0) {
                this.preloadAutoWidthImages(imgs);
            }
        }

        this.$element.addClass(this.options.loadingClass);

        // create stage
        this.$stage = $('<' + this.settings.stageElement + ' class="' + this.settings.stageClass + '"/>')
            .wrap('<div class="' + this.settings.stageOuterClass + '"/>');

        // append stage
        this.$element.append(this.$stage.parent());

        // append content
        this.replace(this.$element.children().not(this.$stage.parent()));

        // check visibility
        if (this.$element.is(':visible')) {
            // update view
            this.refresh();
        } else {
            // invalidate width
            this.invalidate('width');
        }

        this.$element
            .removeClass(this.options.loadingClass)
            .addClass(this.options.loadedClass);

        // register event handlers
        this.registerEventHandlers();

        this.leave('initializing');
        this.trigger('initialized');
    };

    /**
     * Setups the current settings.
     * @todo Remove responsive classes. Why should adaptive designs be brought into IE8?
     * @todo Support for media queries by using `matchMedia` would be nice.
     * @public
     */
    Owl.prototype.setup = function() {
        var viewport = this.viewport(),
            overwrites = this.options.responsive,
            match = -1,
            settings = null;

        if (!overwrites) {
            settings = $.extend({}, this.options);
        } else {
            $.each(overwrites, function(breakpoint) {
                if (breakpoint <= viewport && breakpoint > match) {
                    match = Number(breakpoint);
                }
            });

            settings = $.extend({}, this.options, overwrites[match]);
            if (typeof settings.stagePadding === 'function') {
                settings.stagePadding = settings.stagePadding();
            }
            delete settings.responsive;

            // responsive class
            if (settings.responsiveClass) {
                this.$element.attr('class',
                    this.$element.attr('class').replace(new RegExp('(' + this.options.responsiveClass + '-)\\S+\\s', 'g'), '$1' + match)
                );
            }
        }

        this.trigger('change', { property: { name: 'settings', value: settings } });
        this._breakpoint = match;
        this.settings = settings;
        this.invalidate('settings');
        this.trigger('changed', { property: { name: 'settings', value: this.settings } });
    };

    /**
     * Updates option logic if necessery.
     * @protected
     */
    Owl.prototype.optionsLogic = function() {
        if (this.settings.autoWidth) {
            this.settings.stagePadding = false;
            this.settings.merge = false;
        }
    };

    /**
     * Prepares an item before add.
     * @todo Rename event parameter `content` to `item`.
     * @protected
     * @returns {jQuery|HTMLElement} - The item container.
     */
    Owl.prototype.prepare = function(item) {
        var event = this.trigger('prepare', { content: item });

        if (!event.data) {
            event.data = $('<' + this.settings.itemElement + '/>')
                .addClass(this.options.itemClass).append(item)
        }

        this.trigger('prepared', { content: event.data });

        return event.data;
    };

    /**
     * Updates the view.
     * @public
     */
    Owl.prototype.update = function() {
        var i = 0,
            n = this._pipe.length,
            filter = $.proxy(function(p) { return this[p] }, this._invalidated),
            cache = {};

        while (i < n) {
            if (this._invalidated.all || $.grep(this._pipe[i].filter, filter).length > 0) {
                this._pipe[i].run(cache);
            }
            i++;
        }

        this._invalidated = {};

        !this.is('valid') && this.enter('valid');
    };

    /**
     * Gets the width of the view.
     * @public
     * @param {Owl.Width} [dimension=Owl.Width.Default] - The dimension to return.
     * @returns {Number} - The width of the view in pixel.
     */
    Owl.prototype.width = function(dimension) {
        dimension = dimension || Owl.Width.Default;
        switch (dimension) {
            case Owl.Width.Inner:
            case Owl.Width.Outer:
                return this._width;
            default:
                return this._width - this.settings.stagePadding * 2 + this.settings.margin;
        }
    };

    /**
     * Refreshes the carousel primarily for adaptive purposes.
     * @public
     */
    Owl.prototype.refresh = function() {
        this.enter('refreshing');
        this.trigger('refresh');

        this.setup();

        this.optionsLogic();

        this.$element.addClass(this.options.refreshClass);

        this.update();

        this.$element.removeClass(this.options.refreshClass);

        this.leave('refreshing');
        this.trigger('refreshed');
    };

    /**
     * Checks window `resize` event.
     * @protected
     */
    Owl.prototype.onThrottledResize = function() {
        window.clearTimeout(this.resizeTimer);
        this.resizeTimer = window.setTimeout(this._handlers.onResize, this.settings.responsiveRefreshRate);
    };

    /**
     * Checks window `resize` event.
     * @protected
     */
    Owl.prototype.onResize = function() {
        if (!this._items.length) {
            return false;
        }

        if (this._width === this.$element.width()) {
            return false;
        }

        if (!this.$element.is(':visible')) {
            return false;
        }

        this.enter('resizing');

        if (this.trigger('resize').isDefaultPrevented()) {
            this.leave('resizing');
            return false;
        }

        this.invalidate('width');

        this.refresh();

        this.leave('resizing');
        this.trigger('resized');
    };

    /**
     * Registers event handlers.
     * @todo Check `msPointerEnabled`
     * @todo #261
     * @protected
     */
    Owl.prototype.registerEventHandlers = function() {
        if ($.support.transition) {
            this.$stage.on($.support.transition.end + '.owl.core', $.proxy(this.onTransitionEnd, this));
        }

        if (this.settings.responsive !== false) {
            this.on(window, 'resize', this._handlers.onThrottledResize);
        }

        if (this.settings.mouseDrag) {
            this.$element.addClass(this.options.dragClass);
            this.$stage.on('mousedown.owl.core', $.proxy(this.onDragStart, this));
            this.$stage.on('dragstart.owl.core selectstart.owl.core', function() { return false });
        }

        if (this.settings.touchDrag){
            this.$stage.on('touchstart.owl.core', $.proxy(this.onDragStart, this));
            this.$stage.on('touchcancel.owl.core', $.proxy(this.onDragEnd, this));
        }
    };

    /**
     * Handles `touchstart` and `mousedown` events.
     * @todo Horizontal swipe threshold as option
     * @todo #261
     * @protected
     * @param {Event} event - The event arguments.
     */
    Owl.prototype.onDragStart = function(event) {
        var stage = null;

        if (event.which === 3) {
            return;
        }

        if ($.support.transform) {
            stage = this.$stage.css('transform').replace(/.*\(|\)| /g, '').split(',');
            stage = {
                x: stage[stage.length === 16 ? 12 : 4],
                y: stage[stage.length === 16 ? 13 : 5]
            };
        } else {
            stage = this.$stage.position();
            stage = {
                x: this.settings.rtl ?
                    stage.left + this.$stage.width() - this.width() + this.settings.margin :
                    stage.left,
                y: stage.top
            };
        }

        if (this.is('animating')) {
            $.support.transform ? this.animate(stage.x) : this.$stage.stop()
            this.invalidate('position');
        }

        this.$element.toggleClass(this.options.grabClass, event.type === 'mousedown');

        this.speed(0);

        this._drag.time = new Date().getTime();
        this._drag.target = $(event.target);
        this._drag.stage.start = stage;
        this._drag.stage.current = stage;
        this._drag.pointer = this.pointer(event);

        $(document).on('mouseup.owl.core touchend.owl.core', $.proxy(this.onDragEnd, this));

        $(document).one('mousemove.owl.core touchmove.owl.core', $.proxy(function(event) {
            var delta = this.difference(this._drag.pointer, this.pointer(event));

            $(document).on('mousemove.owl.core touchmove.owl.core', $.proxy(this.onDragMove, this));

            if (Math.abs(delta.x) < Math.abs(delta.y) && this.is('valid')) {
                return;
            }

            event.preventDefault();

            this.enter('dragging');
            this.trigger('drag');
        }, this));
    };

    /**
     * Handles the `touchmove` and `mousemove` events.
     * @todo #261
     * @protected
     * @param {Event} event - The event arguments.
     */
    Owl.prototype.onDragMove = function(event) {
        var minimum = null,
            maximum = null,
            pull = null,
            delta = this.difference(this._drag.pointer, this.pointer(event)),
            stage = this.difference(this._drag.stage.start, delta);

        if (!this.is('dragging')) {
            return;
        }

        event.preventDefault();

        if (this.settings.loop) {
            minimum = this.coordinates(this.minimum());
            maximum = this.coordinates(this.maximum() + 1) - minimum;
            stage.x = (((stage.x - minimum) % maximum + maximum) % maximum) + minimum;
        } else {
            minimum = this.settings.rtl ? this.coordinates(this.maximum()) : this.coordinates(this.minimum());
            maximum = this.settings.rtl ? this.coordinates(this.minimum()) : this.coordinates(this.maximum());
            pull = this.settings.pullDrag ? -1 * delta.x / 5 : 0;
            stage.x = Math.max(Math.min(stage.x, minimum + pull), maximum + pull);
        }

        this._drag.stage.current = stage;

        this.animate(stage.x);
    };

    /**
     * Handles the `touchend` and `mouseup` events.
     * @todo #261
     * @todo Threshold for click event
     * @protected
     * @param {Event} event - The event arguments.
     */
    Owl.prototype.onDragEnd = function(event) {
        var delta = this.difference(this._drag.pointer, this.pointer(event)),
            stage = this._drag.stage.current,
            direction = delta.x > 0 ^ this.settings.rtl ? 'left' : 'right';

        $(document).off('.owl.core');

        this.$element.removeClass(this.options.grabClass);

        if (delta.x !== 0 && this.is('dragging') || !this.is('valid')) {
            this.speed(this.settings.dragEndSpeed || this.settings.smartSpeed);
            this.current(this.closest(stage.x, delta.x !== 0 ? direction : this._drag.direction));
            this.invalidate('position');
            this.update();

            this._drag.direction = direction;

            if (Math.abs(delta.x) > 3 || new Date().getTime() - this._drag.time > 300) {
                this._drag.target.one('click.owl.core', function() { return false; });
            }
        }

        if (!this.is('dragging')) {
            return;
        }

        this.leave('dragging');
        this.trigger('dragged');
    };

    /**
     * Gets absolute position of the closest item for a coordinate.
     * @todo Setting `freeDrag` makes `closest` not reusable. See #165.
     * @protected
     * @param {Number} coordinate - The coordinate in pixel.
     * @param {String} direction - The direction to check for the closest item. Ether `left` or `right`.
     * @return {Number} - The absolute position of the closest item.
     */
    Owl.prototype.closest = function(coordinate, direction) {
        var position = -1,
            pull = 30,
            width = this.width(),
            coordinates = this.coordinates();

        if (!this.settings.freeDrag) {
            // check closest item
            $.each(coordinates, $.proxy(function(index, value) {
                // on a left pull, check on current index
                if (direction === 'left' && coordinate > value - pull && coordinate < value + pull) {
                    position = index;
                // on a right pull, check on previous index
                // to do so, subtract width from value and set position = index + 1
                } else if (direction === 'right' && coordinate > value - width - pull && coordinate < value - width + pull) {
                    position = index + 1;
                } else if (this.op(coordinate, '<', value)
                    && this.op(coordinate, '>', coordinates[index + 1] || value - width)) {
                    position = direction === 'left' ? index + 1 : index;
                }
                return position === -1;
            }, this));
        }

        if (!this.settings.loop) {
            // non loop boundries
            if (this.op(coordinate, '>', coordinates[this.minimum()])) {
                position = coordinate = this.minimum();
            } else if (this.op(coordinate, '<', coordinates[this.maximum()])) {
                position = coordinate = this.maximum();
            }
        }

        return position;
    };

    /**
     * Animates the stage.
     * @todo #270
     * @public
     * @param {Number} coordinate - The coordinate in pixels.
     */
    Owl.prototype.animate = function(coordinate) {
        var animate = this.speed() > 0;

        this.is('animating') && this.onTransitionEnd();

        if (animate) {
            this.enter('animating');
            this.trigger('translate');
        }

        if ($.support.transform3d && $.support.transition) {
            this.$stage.css({
                transform: 'translate3d(' + coordinate + 'px,0px,0px)',
                transition: (this.speed() / 1000) + 's'
            });
        } else if (animate) {
            this.$stage.animate({
                left: coordinate + 'px'
            }, this.speed(), this.settings.fallbackEasing, $.proxy(this.onTransitionEnd, this));
        } else {
            this.$stage.css({
                left: coordinate + 'px'
            });
        }
    };

    /**
     * Checks whether the carousel is in a specific state or not.
     * @param {String} state - The state to check.
     * @returns {Boolean} - The flag which indicates if the carousel is busy.
     */
    Owl.prototype.is = function(state) {
        return this._states.current[state] && this._states.current[state] > 0;
    };

    /**
     * Sets the absolute position of the current item.
     * @public
     * @param {Number} [position] - The new absolute position or nothing to leave it unchanged.
     * @returns {Number} - The absolute position of the current item.
     */
    Owl.prototype.current = function(position) {
        if (position === undefined) {
            return this._current;
        }

        if (this._items.length === 0) {
            return undefined;
        }

        position = this.normalize(position);

        if (this._current !== position) {
            var event = this.trigger('change', { property: { name: 'position', value: position } });

            if (event.data !== undefined) {
                position = this.normalize(event.data);
            }

            this._current = position;

            this.invalidate('position');

            this.trigger('changed', { property: { name: 'position', value: this._current } });
        }

        return this._current;
    };

    /**
     * Invalidates the given part of the update routine.
     * @param {String} [part] - The part to invalidate.
     * @returns {Array.<String>} - The invalidated parts.
     */
    Owl.prototype.invalidate = function(part) {
        if ($.type(part) === 'string') {
            this._invalidated[part] = true;
            this.is('valid') && this.leave('valid');
        }
        return $.map(this._invalidated, function(v, i) { return i });
    };

    /**
     * Resets the absolute position of the current item.
     * @public
     * @param {Number} position - The absolute position of the new item.
     */
    Owl.prototype.reset = function(position) {
        position = this.normalize(position);

        if (position === undefined) {
            return;
        }

        this._speed = 0;
        this._current = position;

        this.suppress([ 'translate', 'translated' ]);

        this.animate(this.coordinates(position));

        this.release([ 'translate', 'translated' ]);
    };

    /**
     * Normalizes an absolute or a relative position of an item.
     * @public
     * @param {Number} position - The absolute or relative position to normalize.
     * @param {Boolean} [relative=false] - Whether the given position is relative or not.
     * @returns {Number} - The normalized position.
     */
    Owl.prototype.normalize = function(position, relative) {
        var n = this._items.length,
            m = relative ? 0 : this._clones.length;

        if (!this.isNumeric(position) || n < 1) {
            position = undefined;
        } else if (position < 0 || position >= n + m) {
            position = ((position - m / 2) % n + n) % n + m / 2;
        }

        return position;
    };

    /**
     * Converts an absolute position of an item into a relative one.
     * @public
     * @param {Number} position - The absolute position to convert.
     * @returns {Number} - The converted position.
     */
    Owl.prototype.relative = function(position) {
        position -= this._clones.length / 2;
        return this.normalize(position, true);
    };

    /**
     * Gets the maximum position for the current item.
     * @public
     * @param {Boolean} [relative=false] - Whether to return an absolute position or a relative position.
     * @returns {Number}
     */
    Owl.prototype.maximum = function(relative) {
        var settings = this.settings,
            maximum = this._coordinates.length,
            iterator,
            reciprocalItemsWidth,
            elementWidth;

        if (settings.loop) {
            maximum = this._clones.length / 2 + this._items.length - 1;
        } else if (settings.autoWidth || settings.merge) {
            iterator = this._items.length;
            reciprocalItemsWidth = this._items[--iterator].width();
            elementWidth = this.$element.width();
            while (iterator--) {
                reciprocalItemsWidth += this._items[iterator].width() + this.settings.margin;
                if (reciprocalItemsWidth > elementWidth) {
                    break;
                }
            }
            maximum = iterator + 1;
        } else if (settings.center) {
            maximum = this._items.length - 1;
        } else {
            maximum = this._items.length - settings.items;
        }

        if (relative) {
            maximum -= this._clones.length / 2;
        }

        return Math.max(maximum, 0);
    };

    /**
     * Gets the minimum position for the current item.
     * @public
     * @param {Boolean} [relative=false] - Whether to return an absolute position or a relative position.
     * @returns {Number}
     */
    Owl.prototype.minimum = function(relative) {
        return relative ? 0 : this._clones.length / 2;
    };

    /**
     * Gets an item at the specified relative position.
     * @public
     * @param {Number} [position] - The relative position of the item.
     * @return {jQuery|Array.<jQuery>} - The item at the given position or all items if no position was given.
     */
    Owl.prototype.items = function(position) {
        if (position === undefined) {
            return this._items.slice();
        }

        position = this.normalize(position, true);
        return this._items[position];
    };

    /**
     * Gets an item at the specified relative position.
     * @public
     * @param {Number} [position] - The relative position of the item.
     * @return {jQuery|Array.<jQuery>} - The item at the given position or all items if no position was given.
     */
    Owl.prototype.mergers = function(position) {
        if (position === undefined) {
            return this._mergers.slice();
        }

        position = this.normalize(position, true);
        return this._mergers[position];
    };

    /**
     * Gets the absolute positions of clones for an item.
     * @public
     * @param {Number} [position] - The relative position of the item.
     * @returns {Array.<Number>} - The absolute positions of clones for the item or all if no position was given.
     */
    Owl.prototype.clones = function(position) {
        var odd = this._clones.length / 2,
            even = odd + this._items.length,
            map = function(index) { return index % 2 === 0 ? even + index / 2 : odd - (index + 1) / 2 };

        if (position === undefined) {
            return $.map(this._clones, function(v, i) { return map(i) });
        }

        return $.map(this._clones, function(v, i) { return v === position ? map(i) : null });
    };

    /**
     * Sets the current animation speed.
     * @public
     * @param {Number} [speed] - The animation speed in milliseconds or nothing to leave it unchanged.
     * @returns {Number} - The current animation speed in milliseconds.
     */
    Owl.prototype.speed = function(speed) {
        if (speed !== undefined) {
            this._speed = speed;
        }

        return this._speed;
    };

    /**
     * Gets the coordinate of an item.
     * @todo The name of this method is missleanding.
     * @public
     * @param {Number} position - The absolute position of the item within `minimum()` and `maximum()`.
     * @returns {Number|Array.<Number>} - The coordinate of the item in pixel or all coordinates.
     */
    Owl.prototype.coordinates = function(position) {
        var multiplier = 1,
            newPosition = position - 1,
            coordinate;

        if (position === undefined) {
            return $.map(this._coordinates, $.proxy(function(coordinate, index) {
                return this.coordinates(index);
            }, this));
        }

        if (this.settings.center) {
            if (this.settings.rtl) {
                multiplier = -1;
                newPosition = position + 1;
            }

            coordinate = this._coordinates[position];
            coordinate += (this.width() - coordinate + (this._coordinates[newPosition] || 0)) / 2 * multiplier;
        } else {
            coordinate = this._coordinates[newPosition] || 0;
        }

        coordinate = Math.ceil(coordinate);

        return coordinate;
    };

    /**
     * Calculates the speed for a translation.
     * @protected
     * @param {Number} from - The absolute position of the start item.
     * @param {Number} to - The absolute position of the target item.
     * @param {Number} [factor=undefined] - The time factor in milliseconds.
     * @returns {Number} - The time in milliseconds for the translation.
     */
    Owl.prototype.duration = function(from, to, factor) {
        if (factor === 0) {
            return 0;
        }

        return Math.min(Math.max(Math.abs(to - from), 1), 6) * Math.abs((factor || this.settings.smartSpeed));
    };

    /**
     * Slides to the specified item.
     * @public
     * @param {Number} position - The position of the item.
     * @param {Number} [speed] - The time in milliseconds for the transition.
     */
    Owl.prototype.to = function(position, speed) {
        var current = this.current(),
            revert = null,
            distance = position - this.relative(current),
            direction = (distance > 0) - (distance < 0),
            items = this._items.length,
            minimum = this.minimum(),
            maximum = this.maximum();

        if (this.settings.loop) {
            if (!this.settings.rewind && Math.abs(distance) > items / 2) {
                distance += direction * -1 * items;
            }

            position = current + distance;
            revert = ((position - minimum) % items + items) % items + minimum;

            if (revert !== position && revert - distance <= maximum && revert - distance > 0) {
                current = revert - distance;
                position = revert;
                this.reset(current);
            }
        } else if (this.settings.rewind) {
            maximum += 1;
            position = (position % maximum + maximum) % maximum;
        } else {
            position = Math.max(minimum, Math.min(maximum, position));
        }

        this.speed(this.duration(current, position, speed));
        this.current(position);

        if (this.$element.is(':visible')) {
            this.update();
        }
    };

    /**
     * Slides to the next item.
     * @public
     * @param {Number} [speed] - The time in milliseconds for the transition.
     */
    Owl.prototype.next = function(speed) {
        speed = speed || false;
        this.to(this.relative(this.current()) + 1, speed);
    };

    /**
     * Slides to the previous item.
     * @public
     * @param {Number} [speed] - The time in milliseconds for the transition.
     */
    Owl.prototype.prev = function(speed) {
        speed = speed || false;
        this.to(this.relative(this.current()) - 1, speed);
    };

    /**
     * Handles the end of an animation.
     * @protected
     * @param {Event} event - The event arguments.
     */
    Owl.prototype.onTransitionEnd = function(event) {

        // if css2 animation then event object is undefined
        if (event !== undefined) {
            event.stopPropagation();

            // Catch only owl-stage transitionEnd event
            if ((event.target || event.srcElement || event.originalTarget) !== this.$stage.get(0)) {
                return false;
            }
        }

        this.leave('animating');
        this.trigger('translated');
    };

    /**
     * Gets viewport width.
     * @protected
     * @return {Number} - The width in pixel.
     */
    Owl.prototype.viewport = function() {
        var width;
        if (this.options.responsiveBaseElement !== window) {
            width = $(this.options.responsiveBaseElement).width();
        } else if (window.innerWidth) {
            width = window.innerWidth;
        } else if (document.documentElement && document.documentElement.clientWidth) {
            width = document.documentElement.clientWidth;
        } else {
            console.warn('Can not detect viewport width.');
        }
        return width;
    };

    /**
     * Replaces the current content.
     * @public
     * @param {HTMLElement|jQuery|String} content - The new content.
     */
    Owl.prototype.replace = function(content) {
        this.$stage.empty();
        this._items = [];

        if (content) {
            content = (content instanceof jQuery) ? content : $(content);
        }

        if (this.settings.nestedItemSelector) {
            content = content.find('.' + this.settings.nestedItemSelector);
        }

        content.filter(function() {
            return this.nodeType === 1;
        }).each($.proxy(function(index, item) {
            item = this.prepare(item);
            this.$stage.append(item);
            this._items.push(item);
            this._mergers.push(item.find('[data-merge]').addBack('[data-merge]').attr('data-merge') * 1 || 1);
        }, this));

        this.reset(this.isNumeric(this.settings.startPosition) ? this.settings.startPosition : 0);

        this.invalidate('items');
    };

    /**
     * Adds an item.
     * @todo Use `item` instead of `content` for the event arguments.
     * @public
     * @param {HTMLElement|jQuery|String} content - The item content to add.
     * @param {Number} [position] - The relative position at which to insert the item otherwise the item will be added to the end.
     */
    Owl.prototype.add = function(content, position) {
        var current = this.relative(this._current);

        position = position === undefined ? this._items.length : this.normalize(position, true);
        content = content instanceof jQuery ? content : $(content);

        this.trigger('add', { content: content, position: position });

        content = this.prepare(content);

        if (this._items.length === 0 || position === this._items.length) {
            this._items.length === 0 && this.$stage.append(content);
            this._items.length !== 0 && this._items[position - 1].after(content);
            this._items.push(content);
            this._mergers.push(content.find('[data-merge]').addBack('[data-merge]').attr('data-merge') * 1 || 1);
        } else {
            this._items[position].before(content);
            this._items.splice(position, 0, content);
            this._mergers.splice(position, 0, content.find('[data-merge]').addBack('[data-merge]').attr('data-merge') * 1 || 1);
        }

        this._items[current] && this.reset(this._items[current].index());

        this.invalidate('items');

        this.trigger('added', { content: content, position: position });
    };

    /**
     * Removes an item by its position.
     * @todo Use `item` instead of `content` for the event arguments.
     * @public
     * @param {Number} position - The relative position of the item to remove.
     */
    Owl.prototype.remove = function(position) {
        position = this.normalize(position, true);

        if (position === undefined) {
            return;
        }

        this.trigger('remove', { content: this._items[position], position: position });

        this._items[position].remove();
        this._items.splice(position, 1);
        this._mergers.splice(position, 1);

        this.invalidate('items');

        this.trigger('removed', { content: null, position: position });
    };

    /**
     * Preloads images with auto width.
     * @todo Replace by a more generic approach
     * @protected
     */
    Owl.prototype.preloadAutoWidthImages = function(images) {
        images.each($.proxy(function(i, element) {
            this.enter('pre-loading');
            element = $(element);
            $(new Image()).one('load', $.proxy(function(e) {
                element.attr('src', e.target.src);
                element.css('opacity', 1);
                this.leave('pre-loading');
                !this.is('pre-loading') && !this.is('initializing') && this.refresh();
            }, this)).attr('src', element.attr('src') || element.attr('data-src') || element.attr('data-src-retina'));
        }, this));
    };

    /**
     * Destroys the carousel.
     * @public
     */
    Owl.prototype.destroy = function() {

        this.$element.off('.owl.core');
        this.$stage.off('.owl.core');
        $(document).off('.owl.core');

        if (this.settings.responsive !== false) {
            window.clearTimeout(this.resizeTimer);
            this.off(window, 'resize', this._handlers.onThrottledResize);
        }

        for (var i in this._plugins) {
            this._plugins[i].destroy();
        }

        this.$stage.children('.cloned').remove();

        this.$stage.unwrap();
        this.$stage.children().contents().unwrap();
        this.$stage.children().unwrap();

        this.$element
            .removeClass(this.options.refreshClass)
            .removeClass(this.options.loadingClass)
            .removeClass(this.options.loadedClass)
            .removeClass(this.options.rtlClass)
            .removeClass(this.options.dragClass)
            .removeClass(this.options.grabClass)
            .attr('class', this.$element.attr('class').replace(new RegExp(this.options.responsiveClass + '-\\S+\\s', 'g'), ''))
            .removeData('owl.carousel');
    };

    /**
     * Operators to calculate right-to-left and left-to-right.
     * @protected
     * @param {Number} [a] - The left side operand.
     * @param {String} [o] - The operator.
     * @param {Number} [b] - The right side operand.
     */
    Owl.prototype.op = function(a, o, b) {
        var rtl = this.settings.rtl;
        switch (o) {
            case '<':
                return rtl ? a > b : a < b;
            case '>':
                return rtl ? a < b : a > b;
            case '>=':
                return rtl ? a <= b : a >= b;
            case '<=':
                return rtl ? a >= b : a <= b;
            default:
                break;
        }
    };

    /**
     * Attaches to an internal event.
     * @protected
     * @param {HTMLElement} element - The event source.
     * @param {String} event - The event name.
     * @param {Function} listener - The event handler to attach.
     * @param {Boolean} capture - Wether the event should be handled at the capturing phase or not.
     */
    Owl.prototype.on = function(element, event, listener, capture) {
        if (element.addEventListener) {
            element.addEventListener(event, listener, capture);
        } else if (element.attachEvent) {
            element.attachEvent('on' + event, listener);
        }
    };

    /**
     * Detaches from an internal event.
     * @protected
     * @param {HTMLElement} element - The event source.
     * @param {String} event - The event name.
     * @param {Function} listener - The attached event handler to detach.
     * @param {Boolean} capture - Wether the attached event handler was registered as a capturing listener or not.
     */
    Owl.prototype.off = function(element, event, listener, capture) {
        if (element.removeEventListener) {
            element.removeEventListener(event, listener, capture);
        } else if (element.detachEvent) {
            element.detachEvent('on' + event, listener);
        }
    };

    /**
     * Triggers a public event.
     * @todo Remove `status`, `relatedTarget` should be used instead.
     * @protected
     * @param {String} name - The event name.
     * @param {*} [data=null] - The event data.
     * @param {String} [namespace=carousel] - The event namespace.
     * @param {String} [state] - The state which is associated with the event.
     * @param {Boolean} [enter=false] - Indicates if the call enters the specified state or not.
     * @returns {Event} - The event arguments.
     */
    Owl.prototype.trigger = function(name, data, namespace, state, enter) {
        var status = {
            item: { count: this._items.length, index: this.current() }
        }, handler = $.camelCase(
            $.grep([ 'on', name, namespace ], function(v) { return v })
                .join('-').toLowerCase()
        ), event = $.Event(
            [ name, 'owl', namespace || 'carousel' ].join('.').toLowerCase(),
            $.extend({ relatedTarget: this }, status, data)
        );

        if (!this._supress[name]) {
            $.each(this._plugins, function(name, plugin) {
                if (plugin.onTrigger) {
                    plugin.onTrigger(event);
                }
            });

            this.register({ type: Owl.Type.Event, name: name });
            this.$element.trigger(event);

            if (this.settings && typeof this.settings[handler] === 'function') {
                this.settings[handler].call(this, event);
            }
        }

        return event;
    };

    /**
     * Enters a state.
     * @param name - The state name.
     */
    Owl.prototype.enter = function(name) {
        $.each([ name ].concat(this._states.tags[name] || []), $.proxy(function(i, name) {
            if (this._states.current[name] === undefined) {
                this._states.current[name] = 0;
            }

            this._states.current[name]++;
        }, this));
    };

    /**
     * Leaves a state.
     * @param name - The state name.
     */
    Owl.prototype.leave = function(name) {
        $.each([ name ].concat(this._states.tags[name] || []), $.proxy(function(i, name) {
            this._states.current[name]--;
        }, this));
    };

    /**
     * Registers an event or state.
     * @public
     * @param {Object} object - The event or state to register.
     */
    Owl.prototype.register = function(object) {
        if (object.type === Owl.Type.Event) {
            if (!$.event.special[object.name]) {
                $.event.special[object.name] = {};
            }

            if (!$.event.special[object.name].owl) {
                var _default = $.event.special[object.name]._default;
                $.event.special[object.name]._default = function(e) {
                    if (_default && _default.apply && (!e.namespace || e.namespace.indexOf('owl') === -1)) {
                        return _default.apply(this, arguments);
                    }
                    return e.namespace && e.namespace.indexOf('owl') > -1;
                };
                $.event.special[object.name].owl = true;
            }
        } else if (object.type === Owl.Type.State) {
            if (!this._states.tags[object.name]) {
                this._states.tags[object.name] = object.tags;
            } else {
                this._states.tags[object.name] = this._states.tags[object.name].concat(object.tags);
            }

            this._states.tags[object.name] = $.grep(this._states.tags[object.name], $.proxy(function(tag, i) {
                return $.inArray(tag, this._states.tags[object.name]) === i;
            }, this));
        }
    };

    /**
     * Suppresses events.
     * @protected
     * @param {Array.<String>} events - The events to suppress.
     */
    Owl.prototype.suppress = function(events) {
        $.each(events, $.proxy(function(index, event) {
            this._supress[event] = true;
        }, this));
    };

    /**
     * Releases suppressed events.
     * @protected
     * @param {Array.<String>} events - The events to release.
     */
    Owl.prototype.release = function(events) {
        $.each(events, $.proxy(function(index, event) {
            delete this._supress[event];
        }, this));
    };

    /**
     * Gets unified pointer coordinates from event.
     * @todo #261
     * @protected
     * @param {Event} - The `mousedown` or `touchstart` event.
     * @returns {Object} - Contains `x` and `y` coordinates of current pointer position.
     */
    Owl.prototype.pointer = function(event) {
        var result = { x: null, y: null };

        event = event.originalEvent || event || window.event;

        event = event.touches && event.touches.length ?
            event.touches[0] : event.changedTouches && event.changedTouches.length ?
                event.changedTouches[0] : event;

        if (event.pageX) {
            result.x = event.pageX;
            result.y = event.pageY;
        } else {
            result.x = event.clientX;
            result.y = event.clientY;
        }

        return result;
    };

    /**
     * Determines if the input is a Number or something that can be coerced to a Number
     * @protected
     * @param {Number|String|Object|Array|Boolean|RegExp|Function|Symbol} - The input to be tested
     * @returns {Boolean} - An indication if the input is a Number or can be coerced to a Number
     */
    Owl.prototype.isNumeric = function(number) {
        return !isNaN(parseFloat(number));
    };

    /**
     * Gets the difference of two vectors.
     * @todo #261
     * @protected
     * @param {Object} - The first vector.
     * @param {Object} - The second vector.
     * @returns {Object} - The difference.
     */
    Owl.prototype.difference = function(first, second) {
        return {
            x: first.x - second.x,
            y: first.y - second.y
        };
    };

    /**
     * The jQuery Plugin for the Owl Carousel
     * @todo Navigation plugin `next` and `prev`
     * @public
     */
    $.fn.owlCarousel = function(option) {
        var args = Array.prototype.slice.call(arguments, 1);

        return this.each(function() {
            var $this = $(this),
                data = $this.data('owl.carousel');

            if (!data) {
                data = new Owl(this, typeof option == 'object' && option);
                $this.data('owl.carousel', data);

                $.each([
                    'next', 'prev', 'to', 'destroy', 'refresh', 'replace', 'add', 'remove'
                ], function(i, event) {
                    data.register({ type: Owl.Type.Event, name: event });
                    data.$element.on(event + '.owl.carousel.core', $.proxy(function(e) {
                        if (e.namespace && e.relatedTarget !== this) {
                            this.suppress([ event ]);
                            data[event].apply(this, [].slice.call(arguments, 1));
                            this.release([ event ]);
                        }
                    }, data));
                });
            }

            if (typeof option == 'string' && option.charAt(0) !== '_') {
                data[option].apply(data, args);
            }
        });
    };

    /**
     * The constructor for the jQuery Plugin
     * @public
     */
    $.fn.owlCarousel.Constructor = Owl;

})(window.Zepto || window.jQuery, window, document);


(function (factory) {

    if ( typeof define === 'function' && define.amd ) {

        // AMD. Register as an anonymous module.
        define([], factory);

    } else if ( typeof exports === 'object' ) {

        // Node/CommonJS
        module.exports = factory();

    } else {

        // Browser globals
        window.wNumb = factory();
    }

}(function(){

    'use strict';

var FormatOptions = [
    'decimals',
    'thousand',
    'mark',
    'prefix',
    'suffix',
    'encoder',
    'decoder',
    'negativeBefore',
    'negative',
    'edit',
    'undo'
];

// General

    // Reverse a string
    function strReverse ( a ) {
        return a.split('').reverse().join('');
    }

    // Check if a string starts with a specified prefix.
    function strStartsWith ( input, match ) {
        return input.substring(0, match.length) === match;
    }

    // Check is a string ends in a specified suffix.
    function strEndsWith ( input, match ) {
        return input.slice(-1 * match.length) === match;
    }

    // Throw an error if formatting options are incompatible.
    function throwEqualError( F, a, b ) {
        if ( (F[a] || F[b]) && (F[a] === F[b]) ) {
            throw new Error(a);
        }
    }

    // Check if a number is finite and not NaN
    function isValidNumber ( input ) {
        return typeof input === 'number' && isFinite( input );
    }

    // Provide rounding-accurate toFixed method.
    // Borrowed: http://stackoverflow.com/a/21323330/775265
    function toFixed ( value, exp ) {
        value = value.toString().split('e');
        value = Math.round(+(value[0] + 'e' + (value[1] ? (+value[1] + exp) : exp)));
        value = value.toString().split('e');
        return (+(value[0] + 'e' + (value[1] ? (+value[1] - exp) : -exp))).toFixed(exp);
    }


// Formatting

    // Accept a number as input, output formatted string.
    function formatTo ( decimals, thousand, mark, prefix, suffix, encoder, decoder, negativeBefore, negative, edit, undo, input ) {

        var originalInput = input, inputIsNegative, inputPieces, inputBase, inputDecimals = '', output = '';

        // Apply user encoder to the input.
        // Expected outcome: number.
        if ( encoder ) {
            input = encoder(input);
        }

        // Stop if no valid number was provided, the number is infinite or NaN.
        if ( !isValidNumber(input) ) {
            return false;
        }

        // Rounding away decimals might cause a value of -0
        // when using very small ranges. Remove those cases.
        if ( decimals !== false && parseFloat(input.toFixed(decimals)) === 0 ) {
            input = 0;
        }

        // Formatting is done on absolute numbers,
        // decorated by an optional negative symbol.
        if ( input < 0 ) {
            inputIsNegative = true;
            input = Math.abs(input);
        }

        // Reduce the number of decimals to the specified option.
        if ( decimals !== false ) {
            input = toFixed( input, decimals );
        }

        // Transform the number into a string, so it can be split.
        input = input.toString();

        // Break the number on the decimal separator.
        if ( input.indexOf('.') !== -1 ) {
            inputPieces = input.split('.');

            inputBase = inputPieces[0];

            if ( mark ) {
                inputDecimals = mark + inputPieces[1];
            }

        } else {

        // If it isn't split, the entire number will do.
            inputBase = input;
        }

        // Group numbers in sets of three.
        if ( thousand ) {
            inputBase = strReverse(inputBase).match(/.{1,3}/g);
            inputBase = strReverse(inputBase.join( strReverse( thousand ) ));
        }

        // If the number is negative, prefix with negation symbol.
        if ( inputIsNegative && negativeBefore ) {
            output += negativeBefore;
        }

        // Prefix the number
        if ( prefix ) {
            output += prefix;
        }

        // Normal negative option comes after the prefix. Defaults to '-'.
        if ( inputIsNegative && negative ) {
            output += negative;
        }

        // Append the actual number.
        output += inputBase;
        output += inputDecimals;

        // Apply the suffix.
        if ( suffix ) {
            output += suffix;
        }

        // Run the output through a user-specified post-formatter.
        if ( edit ) {
            output = edit ( output, originalInput );
        }

        // All done.
        return output;
    }

    // Accept a sting as input, output decoded number.
    function formatFrom ( decimals, thousand, mark, prefix, suffix, encoder, decoder, negativeBefore, negative, edit, undo, input ) {

        var originalInput = input, inputIsNegative, output = '';

        // User defined pre-decoder. Result must be a non empty string.
        if ( undo ) {
            input = undo(input);
        }

        // Test the input. Can't be empty.
        if ( !input || typeof input !== 'string' ) {
            return false;
        }

        // If the string starts with the negativeBefore value: remove it.
        // Remember is was there, the number is negative.
        if ( negativeBefore && strStartsWith(input, negativeBefore) ) {
            input = input.replace(negativeBefore, '');
            inputIsNegative = true;
        }

        // Repeat the same procedure for the prefix.
        if ( prefix && strStartsWith(input, prefix) ) {
            input = input.replace(prefix, '');
        }

        // And again for negative.
        if ( negative && strStartsWith(input, negative) ) {
            input = input.replace(negative, '');
            inputIsNegative = true;
        }

        // Remove the suffix.
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/slice
        if ( suffix && strEndsWith(input, suffix) ) {
            input = input.slice(0, -1 * suffix.length);
        }

        // Remove the thousand grouping.
        if ( thousand ) {
            input = input.split(thousand).join('');
        }

        // Set the decimal separator back to period.
        if ( mark ) {
            input = input.replace(mark, '.');
        }

        // Prepend the negative symbol.
        if ( inputIsNegative ) {
            output += '-';
        }

        // Add the number
        output += input;

        // Trim all non-numeric characters (allow '.' and '-');
        output = output.replace(/[^0-9\.\-.]/g, '');

        // The value contains no parse-able number.
        if ( output === '' ) {
            return false;
        }

        // Covert to number.
        output = Number(output);

        // Run the user-specified post-decoder.
        if ( decoder ) {
            output = decoder(output);
        }

        // Check is the output is valid, otherwise: return false.
        if ( !isValidNumber(output) ) {
            return false;
        }

        return output;
    }


// Framework

    // Validate formatting options
    function validate ( inputOptions ) {

        var i, optionName, optionValue,
            filteredOptions = {};

        if ( inputOptions['suffix'] === undefined ) {
            inputOptions['suffix'] = inputOptions['postfix'];
        }

        for ( i = 0; i < FormatOptions.length; i+=1 ) {

            optionName = FormatOptions[i];
            optionValue = inputOptions[optionName];

            if ( optionValue === undefined ) {

                // Only default if negativeBefore isn't set.
                if ( optionName === 'negative' && !filteredOptions.negativeBefore ) {
                    filteredOptions[optionName] = '-';
                // Don't set a default for mark when 'thousand' is set.
                } else if ( optionName === 'mark' && filteredOptions.thousand !== '.' ) {
                    filteredOptions[optionName] = '.';
                } else {
                    filteredOptions[optionName] = false;
                }

            // Floating points in JS are stable up to 7 decimals.
            } else if ( optionName === 'decimals' ) {
                if ( optionValue >= 0 && optionValue < 8 ) {
                    filteredOptions[optionName] = optionValue;
                } else {
                    throw new Error(optionName);
                }

            // These options, when provided, must be functions.
            } else if ( optionName === 'encoder' || optionName === 'decoder' || optionName === 'edit' || optionName === 'undo' ) {
                if ( typeof optionValue === 'function' ) {
                    filteredOptions[optionName] = optionValue;
                } else {
                    throw new Error(optionName);
                }

            // Other options are strings.
            } else {

                if ( typeof optionValue === 'string' ) {
                    filteredOptions[optionName] = optionValue;
                } else {
                    throw new Error(optionName);
                }
            }
        }

        // Some values can't be extracted from a
        // string if certain combinations are present.
        throwEqualError(filteredOptions, 'mark', 'thousand');
        throwEqualError(filteredOptions, 'prefix', 'negative');
        throwEqualError(filteredOptions, 'prefix', 'negativeBefore');

        return filteredOptions;
    }

    // Pass all options as function arguments
    function passAll ( options, method, input ) {
        var i, args = [];

        // Add all options in order of FormatOptions
        for ( i = 0; i < FormatOptions.length; i+=1 ) {
            args.push(options[FormatOptions[i]]);
        }

        // Append the input, then call the method, presenting all
        // options as arguments.
        args.push(input);
        return method.apply('', args);
    }

    function wNumb ( options ) {

        if ( !(this instanceof wNumb) ) {
            return new wNumb ( options );
        }

        if ( typeof options !== "object" ) {
            return;
        }

        options = validate(options);

        // Call 'formatTo' with proper arguments.
        this.to = function ( input ) {
            return passAll(options, formatTo, input);
        };

        // Call 'formatFrom' with proper arguments.
        this.from = function ( input ) {
            return passAll(options, formatFrom, input);
        };
    }

    return wNumb;

}));

/*-- siema.js----*/

! function(e, t) {
    "object" == typeof exports && "object" == typeof module ? module.exports = t() : "function" == typeof define && define.amd ? define("Siema", [], t) : "object" == typeof exports ? exports.Siema = t() : e.Siema = t()
}(this, function() {
    return function(e) {
        function t(s) {
            if (i[s]) return i[s].exports;
            var r = i[s] = {
                i: s,
                l: !1,
                exports: {}
            };
            return e[s].call(r.exports, r, r.exports, t), r.l = !0, r.exports
        }
        var i = {};
        return t.m = e, t.c = i, t.i = function(e) {
            return e
        }, t.d = function(e, i, s) {
            t.o(e, i) || Object.defineProperty(e, i, {
                configurable: !1,
                enumerable: !0,
                get: s
            })
        }, t.n = function(e) {
            var i = e && e.__esModule ? function() {
                return e.default
            } : function() {
                return e
            };
            return t.d(i, "a", i), i
        }, t.o = function(e, t) {
            return Object.prototype.hasOwnProperty.call(e, t)
        }, t.p = "", t(t.s = 0)
    }([function(e, t, i) {
        "use strict";

        function s(e, t) {
            if (!(e instanceof t)) throw new TypeError("Cannot call a class as a function")
        }
        Object.defineProperty(t, "__esModule", {
            value: !0
        });
        var r = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(e) {
                return typeof e
            } : function(e) {
                return e && "function" == typeof Symbol && e.constructor === Symbol && e !== Symbol.prototype ? "symbol" : typeof e
            },
            n = function() {
                function e(e, t) {
                    for (var i = 0; i < t.length; i++) {
                        var s = t[i];
                        s.enumerable = s.enumerable || !1, s.configurable = !0, "value" in s && (s.writable = !0), Object.defineProperty(e, s.key, s)
                    }
                }
                return function(t, i, s) {
                    return i && e(t.prototype, i), s && e(t, s), t
                }
            }(),
            o = function() {
                function e(t) {
                    var i = this;                 
                    s(this, e), this.config = e.mergeSettings(t), this.selector = "string" == typeof this.config.selector ? document.querySelector(this.config.selector) : this.config.selector, this.selectorWidth = this.selector.offsetWidth, this.innerElements = [].slice.call(this.selector.children), this.currentSlide = this.config.startIndex, this.transformProperty = e.webkitOrNot(), ["resizeHandler", "touchstartHandler", "touchendHandler", "touchmoveHandler", "mousedownHandler", "mouseupHandler", "mouseleaveHandler", "mousemoveHandler"].forEach(function(e) {
                        i[e] = i[e].bind(i)
                    }), this.init()
                }
                return n(e, [{
                    key: "init",
                    value: function() {
                        if (window.addEventListener("resize", this.resizeHandler), this.config.draggable && (this.pointerDown = !1, this.drag = {
                                startX: 0,
                                endX: 0,
                                startY: 0,
                                letItGo: null
                            }, this.selector.addEventListener("touchstart", this.touchstartHandler, {
                                passive: !0
                            }), this.selector.addEventListener("touchend", this.touchendHandler), this.selector.addEventListener("touchmove", this.touchmoveHandler, {
                                passive: !0
                            }), this.selector.addEventListener("mousedown", this.mousedownHandler), this.selector.addEventListener("mouseup", this.mouseupHandler), this.selector.addEventListener("mouseleave", this.mouseleaveHandler), this.selector.addEventListener("mousemove", this.mousemoveHandler)), null === this.selector) throw new Error("Something wrong with your selector ðŸ˜­");
                        this.resolveSlidesNumber(), this.selector.style.overflow = "hidden", this.sliderFrame = document.createElement("div"), this.sliderFrame.style.width = this.selectorWidth / this.perPage * this.innerElements.length + "px", this.sliderFrame.style.webkitTransition = "all " + this.config.duration + "ms " + this.config.easing, this.sliderFrame.style.transition = "all " + this.config.duration + "ms " + this.config.easing, this.config.draggable && (this.selector.style.cursor = "-webkit-grab");
                        for (var e = document.createDocumentFragment(), t = 0; t < this.innerElements.length; t++) {
                            var i = document.createElement("div");
                            console.log("length:"+this.innerElements.length);
                            i.style.cssFloat = "left", i.style.float = "left", i.style.width = 100 / this.innerElements.length  + "%", i.appendChild(this.innerElements[t]), e.appendChild(i)
                        }
                        this.sliderFrame.appendChild(e), this.selector.innerHTML = "", this.selector.appendChild(this.sliderFrame), this.slideToCurrent(), this.config.onInit.call(this)
                    }
                }, {
                    key: "resolveSlidesNumber",
                    value: function() {
                        if ("number" == typeof this.config.perPage) this.perPage = this.config.perPage;
                        else if ("object" === r(this.config.perPage)) {
                            this.perPage = 1;                            
                            for (var e in this.config.perPage) window.innerWidth >= e && (this.perPage = this.config.perPage[e])
                        }
                    }
                }, {
                    key: "prev",
                    value: function() {
                        var e = arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : 1,
                            t = arguments[1];
                        if (!(this.innerElements.length <= this.perPage)) {
                            var i = this.currentSlide;
                            0 === this.currentSlide && this.config.loop ? this.currentSlide = this.innerElements.length - this.perPage : this.currentSlide = Math.max(this.currentSlide - e, 0), i !== this.currentSlide && (this.slideToCurrent(), this.config.onChange.call(this), t && t.call(this))
                        }
                    }
                }, {
                    key: "next",
                    value: function() {
                        var e = arguments.length > 0 && void 0 !== arguments[0] ? arguments[0] : 1,
                            t = arguments[1];
                        if (!(this.innerElements.length <= this.perPage)) {
                            var i = this.currentSlide;
                            this.currentSlide === this.innerElements.length - this.perPage && this.config.loop ? this.currentSlide = 0 : this.currentSlide = Math.min(this.currentSlide + e, this.innerElements.length - this.perPage), i !== this.currentSlide && (this.slideToCurrent(), this.config.onChange.call(this), t && t.call(this))
                        }
                    }
                }, {
                    key: "goTo",
                    value: function(e, t) {
                        if (!(this.innerElements.length <= this.perPage)) {
                            var i = this.currentSlide;
                            this.currentSlide = Math.min(Math.max(e, 0), this.innerElements.length - this.perPage), i !== this.currentSlide && (this.slideToCurrent(), this.config.onChange.call(this), t && t.call(this))
                        }
                    }
                }, {
                    key: "slideToCurrent",
                    value: function() {
                        this.sliderFrame.style[this.transformProperty] = "translate3d(-" + this.currentSlide * (this.selectorWidth / this.perPage) + "px, 0, 0)"
                    }
                }, {
                    key: "updateAfterDrag",
                    value: function() {
                        var e = this.drag.endX - this.drag.startX,
                            t = Math.abs(e),
                            i = Math.ceil(t / (this.selectorWidth / this.perPage));
                        e > 0 && t > this.config.threshold && this.innerElements.length > this.perPage ? this.prev(i) : e < 0 && t > this.config.threshold && this.innerElements.length > this.perPage && this.next(i), this.slideToCurrent()
                    }
                }, {
                    key: "resizeHandler",
                    value: function() {
                        console.log("this.selectorWidth",this.selector.offsetWidth);                            
                        if(this.selector.offsetWidth == 0){
                            console.log("chnage width");
                            this.selector.offsetWidth = 334;
                            this.resolveSlidesNumber(), this.selectorWidth = this.selector.offsetWidth, this.sliderFrame.style.width = this.selectorWidth / this.perPage * this.innerElements.length + "px", this.slideToCurrent()
                        }else{
                           this.resolveSlidesNumber(), this.selectorWidth = this.selector.offsetWidth, this.sliderFrame.style.width = this.selectorWidth / this.perPage * this.innerElements.length + "px", this.slideToCurrent()
                            }
                    }

                }, {
                    key: "clearDrag",
                    value: function() {
                        this.drag = {
                            startX: 0,
                            endX: 0,
                            startY: 0,
                            letItGo: null
                        }
                    }
                }, {
                    key: "touchstartHandler",
                    value: function(e) {
                        e.stopPropagation(), this.pointerDown = !0, this.drag.startX = e.touches[0].pageX, this.drag.startY = e.touches[0].pageY
                    }
                }, {
                    key: "touchendHandler",
                    value: function(e) {
                        e.stopPropagation(), this.pointerDown = !1, this.sliderFrame.style.webkitTransition = "all " + this.config.duration + "ms " + this.config.easing, this.sliderFrame.style.transition = "all " + this.config.duration + "ms " + this.config.easing, this.drag.endX && this.updateAfterDrag(), this.clearDrag()
                    }
                }, {
                    key: "touchmoveHandler",
                    value: function(e) {
                        e.stopPropagation(), null === this.drag.letItGo && (this.drag.letItGo = Math.abs(this.drag.startY - e.touches[0].pageY) < Math.abs(this.drag.startX - e.touches[0].pageX)), this.pointerDown && this.drag.letItGo && (this.drag.endX = e.touches[0].pageX, this.sliderFrame.style.webkitTransition = "all 0ms " + this.config.easing, this.sliderFrame.style.transition = "all 0ms " + this.config.easing, this.sliderFrame.style[this.transformProperty] = "translate3d(" + (this.currentSlide * (this.selectorWidth / this.perPage) + (this.drag.startX - this.drag.endX)) * -1 + "px, 0, 0)")
                    }
                }, {
                    key: "mousedownHandler",
                    value: function(e) {
                        e.preventDefault(), e.stopPropagation(), this.pointerDown = !0, this.drag.startX = e.pageX
                    }
                }, {
                    key: "mouseupHandler",
                    value: function(e) {
                        e.stopPropagation(), this.pointerDown = !1, this.selector.style.cursor = "-webkit-grab", this.sliderFrame.style.webkitTransition = "all " + this.config.duration + "ms " + this.config.easing, this.sliderFrame.style.transition = "all " + this.config.duration + "ms " + this.config.easing, this.drag.endX && this.updateAfterDrag(), this.clearDrag()
                    }
                }, {
                    key: "mousemoveHandler",
                    value: function(e) {
                        e.preventDefault(), this.pointerDown && (this.drag.endX = e.pageX, this.selector.style.cursor = "-webkit-grabbing", this.sliderFrame.style.webkitTransition = "all 0ms " + this.config.easing, this.sliderFrame.style.transition = "all 0ms " + this.config.easing, this.sliderFrame.style[this.transformProperty] = "translate3d(" + (this.currentSlide * (this.selectorWidth / this.perPage) + (this.drag.startX - this.drag.endX)) * -1 + "px, 0, 0)")
                    }
                }, {
                    key: "mouseleaveHandler",
                    value: function(e) {
                        this.pointerDown && (this.pointerDown = !1, this.selector.style.cursor = "-webkit-grab", this.drag.endX = e.pageX, this.sliderFrame.style.webkitTransition = "all " + this.config.duration + "ms " + this.config.easing, this.sliderFrame.style.transition = "all " + this.config.duration + "ms " + this.config.easing, this.updateAfterDrag(), this.clearDrag())
                    }
                }, {
                    key: "updateFrame",
                    value: function() {
                        this.sliderFrame = document.createElement("div"), this.sliderFrame.style.width = this.selectorWidth / this.perPage * this.innerElements.length + "px", this.sliderFrame.style.webkitTransition = "all " + this.config.duration + "ms " + this.config.easing, this.sliderFrame.style.transition = "all " + this.config.duration + "ms " + this.config.easing, this.config.draggable && (this.selector.style.cursor = "-webkit-grab");
                        for (var e = document.createDocumentFragment(), t = 0; t < this.innerElements.length; t++) {
                            var i = document.createElement("div");
                            i.style.cssFloat = "left", i.style.float = "left", i.style.width = 100 / this.innerElements.length + "%", i.appendChild(this.innerElements[t]), e.appendChild(i)
                        }
                        this.sliderFrame.appendChild(e), this.selector.innerHTML = "", this.selector.appendChild(this.sliderFrame), this.slideToCurrent()
                    }
                }, {
                    key: "remove",
                    value: function(e, t) {
                        if (e < 0 || e >= this.innerElements.length) throw new Error("Item to remove doesn't exist ðŸ˜­");
                        this.innerElements.splice(e, 1), this.currentSlide = e <= this.currentSlide ? this.currentSlide - 1 : this.currentSlide, this.updateFrame(), t && t.call(this)
                    }
                }, {
                    key: "insert",
                    value: function(e, t, i) {
                        if (t < 0 || t > this.innerElements.length + 1) throw new Error("Unable to inset it at this index ðŸ˜­");
                        if (this.innerElements.indexOf(e) !== -1) throw new Error("The same item in a carousel? Really? Nope ðŸ˜­");
                        this.innerElements.splice(t, 0, e), this.currentSlide = t <= this.currentSlide ? this.currentSlide + 1 : this.currentSlide, this.updateFrame(), i && i.call(this)
                    }
                }, {
                    key: "prepend",
                    value: function(e, t) {
                        this.insert(e, 0), t && t.call(this)
                    }
                }, {
                    key: "append",
                    value: function(e, t) {
                        this.insert(e, this.innerElements.length + 1), t && t.call(this)
                    }
                }, {
                    key: "destroy",
                    value: function() {
                        var e = arguments.length > 0 && void 0 !== arguments[0] && arguments[0],
                            t = arguments[1];
                        if (window.removeEventListener("resize", this.resizeHandler), this.selector.style.cursor = "auto", this.selector.removeEventListener("touchstart", this.touchstartHandler), this.selector.removeEventListener("touchend", this.touchendHandler), this.selector.removeEventListener("touchmove", this.touchmoveHandler), this.selector.removeEventListener("mousedown", this.mousedownHandler), this.selector.removeEventListener("mouseup", this.mouseupHandler), this.selector.removeEventListener("mouseleave", this.mouseleaveHandler), this.selector.removeEventListener("mousemove", this.mousemoveHandler), e) {
                            for (var i = document.createDocumentFragment(), s = 0; s < this.innerElements.length; s++) i.appendChild(this.innerElements[s]);
                            this.selector.innerHTML = "", this.selector.appendChild(i), this.selector.removeAttribute("style")
                        }
                        t && t.call(this)
                    }
                }], [{
                    key: "mergeSettings",
                    value: function(e) {
                        var t = {
                                selector: ".siema",
                                duration: 200,
                                easing: "ease-out",
                                perPage: 1,
                                startIndex: 0,
                                draggable: !0,
                                threshold: 20,
                                loop: !1,
                                onInit: function() {},
                                onChange: function() {}
                            },
                            i = e;
                        for (var s in i) t[s] = i[s];
                        return t
                    }
                }, {
                    key: "webkitOrNot",
                    value: function() {
                        var e = document.documentElement.style;
                        return "string" == typeof e.transform ? "transform" : "WebkitTransform"
                    }
                }]), e
            }();
        t.default = o, e.exports = t.default
    }])
});


/*-- select.js----*/

var snfSelect = function(target, settings) {

    this.target      = null;
    this.select      = null;
    this.display     = null;
    this.list        = null;
    this.options     = [];
    this.isLarge     = false;
    this.value       = null;
    this.selected    = null;
    this.settings    = null;
    this.highlighted = null;

    this.init = function() {
        switch(typeof target) {
            case 'object':
                this.target = target;
                break;
            case 'string': 
                this.target = document.querySelector(target);
                break;
        }

        this.settings = this.getSettings(settings);
        this.buildSelect();

        this.target.parentNode.replaceChild(this.select, this.target);
        this.target.style.display = 'none';
        this.select.appendChild(this.target);

        document.addEventListener('click', this.handleClickOff.bind(this));
        this.positionList();
    };

    this.buildSelect = function() {
        this.select = document.createElement('div');
        this.select.classList.add('snf-widget-select-wrap');
        //this.select.setAttribute('tabindex', this.target.tabIndex);
        this.select.addEventListener('keydown', this.handleSelectKeydown.bind(this));

        this.display = document.createElement('span');
        this.display.classList.add('snf-widget-select-value');
        this.display.addEventListener('click', this.handleDisplayClick.bind(this));
        this.select.appendChild(this.display);

        this.buildList();

        if(this.options.length) {
            this.value = this.options[this.target.selectedIndex].getAttribute('data-value');
            this.selected = this.options[this.target.selectedIndex];
            this.display.innerHTML = this.selected.innerHTML;
        }

        if(
            (this.settings.filtered === 'auto' && this.options.length >= this.settings.filter_threshold) ||
            this.settings.filtered === true
        ) {
            this.isLarge = true;
            this.select.classList.add('snf-widget-select-large');
        }

    };

    this.buildList = function() {
        this.list = document.createElement('div');
        this.list.classList.add('snf-widget-select-list');
        this.list.setAttribute('tabindex', '-1');
        this.list.addEventListener('keydown', this.handleListKeydown.bind(this));
        this.list.addEventListener('mouseenter', function() {
            this.options[this.highlighted].classList.remove('snf-widget-select-hovered');
        }.bind(this));

        this.highlighted = this.target.selectedIndex;

        this.buildFilter();
        this.buildOptions();

        this.select.appendChild(this.list);
    };

    this.buildFilter = function() {
        var wrapper = document.createElement('div');
            wrapper.classList.add('snf-widget-select-filter');

        this.filter = document.createElement('input');
        this.filter.type = 'text';
        this.filter.setAttribute('placeholder',this.settings.filter_placeholder);
        this.filter.addEventListener('keyup', this.handleFilterKeyup.bind(this));

        wrapper.appendChild(this.filter);
        this.list.appendChild(wrapper);
    };

    this.buildOptions = function() {
        var ul = document.createElement('ul');

        var options = this.target.querySelectorAll('option');

        for(var i = 0; i < options.length; i++) {
            var li = document.createElement('li');
                li.setAttribute('data-value', options[i].value);
                li.innerHTML = options[i].innerHTML;
                li.addEventListener('click', this.handleOptionClick.bind(this));

            ul.appendChild(li);
            this.options.push(li);
        }

        this.list.appendChild(ul);
    };

    this.toggleList = function() {
        if(this.list.classList.contains('snf-widget-select-open')) {
            this.list.classList.remove('snf-widget-select-open');
            this.options[this.highlighted].classList.remove('snf-widget-select-hovered');
            this.select.focus();
        } else {
            this.options[this.target.selectedIndex].classList.add('snf-widget-select-hovered');
            this.highlighted = this.target.selectedIndex;
            this.list.classList.add('snf-widget-select-open');
            this.list.focus();
        }
    };

    this.positionList = function() {
        if(!this.isLarge) {
            this.list.style.top = '-' + this.selected.offsetTop + 'px';
        }
    };

    this.highlightOption = function(dir) {
        var next = null;
        switch(dir) {
            case 'up':
                next = (this.highlighted-1 < 0) ? this.highlighted : this.highlighted-1;
                break;
            case 'down':
                next = (this.highlighted+1 > this.options.length-1) ? this.highlighted : this.highlighted+1;
                break;
            default:
                next = this.highlighted;
        }
        this.options[this.highlighted].classList.remove('snf-widget-select-hovered');
        this.options[next].classList.add('snf-widget-select-hovered');
        this.highlighted = next;
    };

    this.clearFilter = function() {
        this.filter.value = '';

        for(var i = 0; i < this.options.length; i++) {
            this.options[i].style.display = 'block';
        }
    };

    this.closeList = function() {
        this.list.classList.remove('snf-widget-select-open');
        this.options[this.highlighted].classList.remove('snf-widget-select-hovered');
    };

    this.getSettings = function(settings) {
        var defaults = {
            filtered: 'auto',
            filter_threshold: 8,
            filter_placeholder: 'Search here'
        };

        for(var p in settings) {
            defaults[p] = settings[p];
        }

        return defaults;
    };

    // EVENT HANDLERS

    this.handleSelectKeydown = function(e) {
        if (this.select === document.activeElement && e.keyCode == 32) {
            this.toggleList();
        }
    };

    this.handleDisplayClick = function(e) {
        this.list.classList.add('snf-widget-select-open');

        if(this.isLarge) {
            this.filter.focus();
        }
    };

    this.handleListKeydown = function(e) {
        if(this.list === document.activeElement) {
            switch(e.keyCode) {
                case 38:
                    this.highlightOption('up');
                    break;
                case 40:
                    this.highlightOption('down');
                    break;
                case 13:
                    this.target.value = this.options[this.highlighted].getAttribute('data-value');
                    this.selected = this.options[this.highlighted];
                    this.display.innerHTML = this.options[this.highlighted].innerHTML;
                    this.closeList();
                    setTimeout(this.positionList.bind(this), 200);
                    this.select.focus();
                    break;
            }
        }
    };

    this.handleFilterKeyup = function(e) {
        var self = this;

        this.options.filter(function(li) {
            if(li.innerHTML.substring(0, self.filter.value.length).toLowerCase() == self.filter.value.toLowerCase()) {
                li.style.display = 'block';
            } else {
                li.style.display = 'none';
            }
        });
    };

    this.handleOptionClick = function(e) {
        this.display.innerHTML = e.target.innerHTML;
        this.target.value      = e.target.getAttribute('data-value');
        this.value             = this.target.value;
        this.selected          = e.target;

        this.closeList();
        this.clearFilter();

        setTimeout(this.positionList.bind(this), 200);
    };

    this.handleClickOff = function(e) {
        if(!this.select.contains(e.target)) {
            this.closeList();
        }
    };

    this.init();

};



/*---- range-slider.js file--*/
// Ion.RangeSlider | version 2.2.0 | https://github.com/IonDen/ion.rangeSlider
// Ion.RangeSlider | version 2.2.0 | https://github.com/IonDen/ion.rangeSlider
// Ion.RangeSlider | version 2.2.0 | https://github.com/IonDen/ion.rangeSlider
;(function(f){"function"===typeof define&&define.amd?define(["jquery"],function(n){return f(n,document,window,navigator)}):"object"===typeof exports?f(require("jquery"),document,window,navigator):f(jQuery,document,window,navigator)})(function(f,n,k,r,p){var t=0,m=function(){var a=r.userAgent,b=/msie\s\d+/i;return 0<a.search(b)&&(a=b.exec(a).toString(),a=a.split(" ")[1],9>a)?(f("html").addClass("lt-ie9"),!0):!1}();Function.prototype.bind||(Function.prototype.bind=function(a){var b=this,d=[].slice;if("function"!=
typeof b)throw new TypeError;var c=d.call(arguments,1),e=function(){if(this instanceof e){var g=function(){};g.prototype=b.prototype;var g=new g,l=b.apply(g,c.concat(d.call(arguments)));return Object(l)===l?l:g}return b.apply(a,c.concat(d.call(arguments)))};return e});Array.prototype.indexOf||(Array.prototype.indexOf=function(a,b){if(null==this)throw new TypeError('"this" is null or not defined');var d=Object(this),c=d.length>>>0;if(0===c)return-1;var e=+b||0;Infinity===Math.abs(e)&&(e=0);if(e>=c)return-1;
for(e=Math.max(0<=e?e:c-Math.abs(e),0);e<c;){if(e in d&&d[e]===a)return e;e++}return-1});var q=function(a,b,d){this.VERSION="2.2.0";this.input=a;this.plugin_count=d;this.old_to=this.old_from=this.update_tm=this.calc_count=this.current_plugin=0;this.raf_id=this.old_min_interval=null;this.no_diapason=this.force_redraw=this.dragging=!1;this.has_tab_index=!0;this.is_update=this.is_key=!1;this.is_start=!0;this.is_click=this.is_resize=this.is_active=this.is_finish=!1;b=b||{};this.$cache={win:f(k),body:f(n.body),
input:f(a),cont:null,rs:null,min:null,max:null,from:null,to:null,single:null,bar:null,line:null,s_single:null,s_from:null,s_to:null,shad_single:null,shad_from:null,shad_to:null,edge:null,grid:null,grid_labels:[]};this.coords={x_gap:0,x_pointer:0,w_rs:0,w_rs_old:0,w_handle:0,p_gap:0,p_gap_left:0,p_gap_right:0,p_step:0,p_pointer:0,p_handle:0,p_single_fake:0,p_single_real:0,p_from_fake:0,p_from_real:0,p_to_fake:0,p_to_real:0,p_bar_x:0,p_bar_w:0,grid_gap:0,big_num:0,big:[],big_w:[],big_p:[],big_x:[]};
this.labels={w_min:0,w_max:0,w_from:0,w_to:0,w_single:0,p_min:0,p_max:0,p_from_fake:0,p_from_left:0,p_to_fake:0,p_to_left:0,p_single_fake:0,p_single_left:0};var c=this.$cache.input;a=c.prop("value");var e;d={type:"single",min:10,max:100,from:null,to:null,step:1,min_interval:0,max_interval:0,drag_interval:!1,values:[],p_values:[],from_fixed:!1,from_min:null,from_max:null,from_shadow:!1,to_fixed:!1,to_min:null,to_max:null,to_shadow:!1,prettify_enabled:!0,prettify_separator:" ",prettify:null,force_edges:!1,
keyboard:!0,grid:!1,grid_margin:!0,grid_num:4,grid_snap:!1,hide_min_max:!1,hide_from_to:!1,prefix:"",postfix:"",max_postfix:"",decorate_both:!0,values_separator:" \u2014 ",input_values_separator:";",disable:!1,block:!1,extra_classes:"",scope:null,onStart:null,onChange:null,onFinish:null,onUpdate:null};"INPUT"!==c[0].nodeName&&console&&console.warn&&console.warn("Base element should be <input>!",c[0]);c={type:c.data("type"),min:c.data("min"),max:c.data("max"),from:c.data("from"),to:c.data("to"),step:c.data("step"),
min_interval:c.data("minInterval"),max_interval:c.data("maxInterval"),drag_interval:c.data("dragInterval"),values:c.data("values"),from_fixed:c.data("fromFixed"),from_min:c.data("fromMin"),from_max:c.data("fromMax"),from_shadow:c.data("fromShadow"),to_fixed:c.data("toFixed"),to_min:c.data("toMin"),to_max:c.data("toMax"),to_shadow:c.data("toShadow"),prettify_enabled:c.data("prettifyEnabled"),prettify_separator:c.data("prettifySeparator"),force_edges:c.data("forceEdges"),keyboard:c.data("keyboard"),
grid:c.data("grid"),grid_margin:c.data("gridMargin"),grid_num:c.data("gridNum"),grid_snap:c.data("gridSnap"),hide_min_max:c.data("hideMinMax"),hide_from_to:c.data("hideFromTo"),prefix:c.data("prefix"),postfix:c.data("postfix"),max_postfix:c.data("maxPostfix"),decorate_both:c.data("decorateBoth"),values_separator:c.data("valuesSeparator"),input_values_separator:c.data("inputValuesSeparator"),disable:c.data("disable"),block:c.data("block"),extra_classes:c.data("extraClasses")};c.values=c.values&&c.values.split(",");
for(e in c)c.hasOwnProperty(e)&&(c[e]!==p&&""!==c[e]||delete c[e]);a!==p&&""!==a&&(a=a.split(c.input_values_separator||b.input_values_separator||";"),a[0]&&a[0]==+a[0]&&(a[0]=+a[0]),a[1]&&a[1]==+a[1]&&(a[1]=+a[1]),b&&b.values&&b.values.length?(d.from=a[0]&&b.values.indexOf(a[0]),d.to=a[1]&&b.values.indexOf(a[1])):(d.from=a[0]&&+a[0],d.to=a[1]&&+a[1]));f.extend(d,b);f.extend(d,c);this.options=d;this.update_check={};this.validate();this.result={input:this.$cache.input,slider:null,min:this.options.min,
max:this.options.max,from:this.options.from,from_percent:0,from_value:null,to:this.options.to,to_percent:0,to_value:null};this.init()};q.prototype={init:function(a){this.no_diapason=!1;this.coords.p_step=this.convertToPercent(this.options.step,!0);this.target="base";this.toggleInput();this.append();this.setMinMax();a?(this.force_redraw=!0,this.calc(!0),this.callOnUpdate()):(this.force_redraw=!0,this.calc(!0),this.callOnStart());this.updateScene()},append:function(){this.$cache.input.before('<span class="irs js-irs-'+
this.plugin_count+" "+this.options.extra_classes+'"></span>');this.$cache.input.prop("readonly",!0);this.$cache.cont=this.$cache.input.prev();this.result.slider=this.$cache.cont;this.$cache.cont.html('<span class="irs"><span class="irs-line" tabindex="0"><span class="irs-line-left"></span><span class="irs-line-mid"></span><span class="irs-line-right"></span></span><span class="irs-min">0</span><span class="irs-max">1</span><span class="irs-from">0</span><span class="irs-to">0</span><span class="irs-single">0</span></span><span class="irs-grid"></span><span class="irs-bar"></span>');
this.$cache.rs=this.$cache.cont.find(".irs");this.$cache.min=this.$cache.cont.find(".irs-min");this.$cache.max=this.$cache.cont.find(".irs-max");this.$cache.from=this.$cache.cont.find(".irs-from");this.$cache.to=this.$cache.cont.find(".irs-to");this.$cache.single=this.$cache.cont.find(".irs-single");this.$cache.bar=this.$cache.cont.find(".irs-bar");this.$cache.line=this.$cache.cont.find(".irs-line");this.$cache.grid=this.$cache.cont.find(".irs-grid");"single"===this.options.type?(this.$cache.cont.append('<span class="irs-bar-edge"></span><span class="irs-shadow shadow-single"></span><span class="irs-slider single"></span>'),
this.$cache.edge=this.$cache.cont.find(".irs-bar-edge"),this.$cache.s_single=this.$cache.cont.find(".single"),this.$cache.from[0].style.visibility="hidden",this.$cache.to[0].style.visibility="hidden",this.$cache.shad_single=this.$cache.cont.find(".shadow-single")):(this.$cache.cont.append('<span class="irs-shadow shadow-from"></span><span class="irs-shadow shadow-to"></span><span class="irs-slider from"></span><span class="irs-slider to"></span>'),this.$cache.s_from=this.$cache.cont.find(".from"),
this.$cache.s_to=this.$cache.cont.find(".to"),this.$cache.shad_from=this.$cache.cont.find(".shadow-from"),this.$cache.shad_to=this.$cache.cont.find(".shadow-to"),this.setTopHandler());this.options.hide_from_to&&(this.$cache.from[0].style.display="none",this.$cache.to[0].style.display="none",this.$cache.single[0].style.display="none");this.appendGrid();this.options.disable?(this.appendDisableMask(),this.$cache.input[0].disabled=!0):(this.$cache.input[0].disabled=!1,this.removeDisableMask(),this.bindEvents());
this.options.disable||(this.options.block?this.appendDisableMask():this.removeDisableMask());this.options.drag_interval&&(this.$cache.bar[0].style.cursor="ew-resize")},setTopHandler:function(){var a=this.options.max,b=this.options.to;this.options.from>this.options.min&&b===a?this.$cache.s_from.addClass("type_last"):b<a&&this.$cache.s_to.addClass("type_last")},changeLevel:function(a){switch(a){case "single":this.coords.p_gap=this.toFixed(this.coords.p_pointer-this.coords.p_single_fake);this.$cache.s_single.addClass("state_hover");
break;case "from":this.coords.p_gap=this.toFixed(this.coords.p_pointer-this.coords.p_from_fake);this.$cache.s_from.addClass("state_hover");this.$cache.s_from.addClass("type_last");this.$cache.s_to.removeClass("type_last");break;case "to":this.coords.p_gap=this.toFixed(this.coords.p_pointer-this.coords.p_to_fake);this.$cache.s_to.addClass("state_hover");this.$cache.s_to.addClass("type_last");this.$cache.s_from.removeClass("type_last");break;case "both":this.coords.p_gap_left=this.toFixed(this.coords.p_pointer-
this.coords.p_from_fake),this.coords.p_gap_right=this.toFixed(this.coords.p_to_fake-this.coords.p_pointer),this.$cache.s_to.removeClass("type_last"),this.$cache.s_from.removeClass("type_last")}},appendDisableMask:function(){this.$cache.cont.append('<span class="irs-disable-mask"></span>');this.$cache.cont.addClass("irs-disabled")},removeDisableMask:function(){this.$cache.cont.remove(".irs-disable-mask");this.$cache.cont.removeClass("irs-disabled")},remove:function(){this.$cache.cont.remove();this.$cache.cont=
null;this.$cache.line.off("keydown.irs_"+this.plugin_count);this.$cache.body.off("touchmove.irs_"+this.plugin_count);this.$cache.body.off("mousemove.irs_"+this.plugin_count);this.$cache.win.off("touchend.irs_"+this.plugin_count);this.$cache.win.off("mouseup.irs_"+this.plugin_count);m&&(this.$cache.body.off("mouseup.irs_"+this.plugin_count),this.$cache.body.off("mouseleave.irs_"+this.plugin_count));this.$cache.grid_labels=[];this.coords.big=[];this.coords.big_w=[];this.coords.big_p=[];this.coords.big_x=
[];cancelAnimationFrame(this.raf_id)},bindEvents:function(){if(!this.no_diapason){this.$cache.body.on("touchmove.irs_"+this.plugin_count,this.pointerMove.bind(this));this.$cache.body.on("mousemove.irs_"+this.plugin_count,this.pointerMove.bind(this));this.$cache.win.on("touchend.irs_"+this.plugin_count,this.pointerUp.bind(this));this.$cache.win.on("mouseup.irs_"+this.plugin_count,this.pointerUp.bind(this));this.$cache.line.on("touchstart.irs_"+this.plugin_count,this.pointerClick.bind(this,"click"));
this.$cache.line.on("mousedown.irs_"+this.plugin_count,this.pointerClick.bind(this,"click"));this.$cache.line.on("focus.irs_"+this.plugin_count,this.pointerFocus.bind(this));this.options.drag_interval&&"double"===this.options.type?(this.$cache.bar.on("touchstart.irs_"+this.plugin_count,this.pointerDown.bind(this,"both")),this.$cache.bar.on("mousedown.irs_"+this.plugin_count,this.pointerDown.bind(this,"both"))):(this.$cache.bar.on("touchstart.irs_"+this.plugin_count,this.pointerClick.bind(this,"click")),
this.$cache.bar.on("mousedown.irs_"+this.plugin_count,this.pointerClick.bind(this,"click")));"single"===this.options.type?(this.$cache.single.on("touchstart.irs_"+this.plugin_count,this.pointerDown.bind(this,"single")),this.$cache.s_single.on("touchstart.irs_"+this.plugin_count,this.pointerDown.bind(this,"single")),this.$cache.shad_single.on("touchstart.irs_"+this.plugin_count,this.pointerClick.bind(this,"click")),this.$cache.single.on("mousedown.irs_"+this.plugin_count,this.pointerDown.bind(this,
"single")),this.$cache.s_single.on("mousedown.irs_"+this.plugin_count,this.pointerDown.bind(this,"single")),this.$cache.edge.on("mousedown.irs_"+this.plugin_count,this.pointerClick.bind(this,"click")),this.$cache.shad_single.on("mousedown.irs_"+this.plugin_count,this.pointerClick.bind(this,"click"))):(this.$cache.single.on("touchstart.irs_"+this.plugin_count,this.pointerDown.bind(this,null)),this.$cache.single.on("mousedown.irs_"+this.plugin_count,this.pointerDown.bind(this,null)),this.$cache.from.on("touchstart.irs_"+
this.plugin_count,this.pointerDown.bind(this,"from")),this.$cache.s_from.on("touchstart.irs_"+this.plugin_count,this.pointerDown.bind(this,"from")),this.$cache.to.on("touchstart.irs_"+this.plugin_count,this.pointerDown.bind(this,"to")),this.$cache.s_to.on("touchstart.irs_"+this.plugin_count,this.pointerDown.bind(this,"to")),this.$cache.shad_from.on("touchstart.irs_"+this.plugin_count,this.pointerClick.bind(this,"click")),this.$cache.shad_to.on("touchstart.irs_"+this.plugin_count,this.pointerClick.bind(this,
"click")),this.$cache.from.on("mousedown.irs_"+this.plugin_count,this.pointerDown.bind(this,"from")),this.$cache.s_from.on("mousedown.irs_"+this.plugin_count,this.pointerDown.bind(this,"from")),this.$cache.to.on("mousedown.irs_"+this.plugin_count,this.pointerDown.bind(this,"to")),this.$cache.s_to.on("mousedown.irs_"+this.plugin_count,this.pointerDown.bind(this,"to")),this.$cache.shad_from.on("mousedown.irs_"+this.plugin_count,this.pointerClick.bind(this,"click")),this.$cache.shad_to.on("mousedown.irs_"+
this.plugin_count,this.pointerClick.bind(this,"click")));if(this.options.keyboard)this.$cache.line.on("keydown.irs_"+this.plugin_count,this.key.bind(this,"keyboard"));m&&(this.$cache.body.on("mouseup.irs_"+this.plugin_count,this.pointerUp.bind(this)),this.$cache.body.on("mouseleave.irs_"+this.plugin_count,this.pointerUp.bind(this)))}},pointerFocus:function(a){if(!this.target){var b="single"===this.options.type?this.$cache.single:this.$cache.from;a=b.offset().left;a+=b.width()/2-1;this.pointerClick("single",
{preventDefault:function(){},pageX:a})}},pointerMove:function(a){this.dragging&&(this.coords.x_pointer=(a.pageX||a.originalEvent.touches&&a.originalEvent.touches[0].pageX)-this.coords.x_gap,this.calc())},pointerUp:function(a){this.current_plugin===this.plugin_count&&this.is_active&&(this.is_active=!1,this.$cache.cont.find(".state_hover").removeClass("state_hover"),this.force_redraw=!0,m&&f("*").prop("unselectable",!1),this.updateScene(),this.restoreOriginalMinInterval(),(f.contains(this.$cache.cont[0],
a.target)||this.dragging)&&this.callOnFinish(),this.dragging=!1)},pointerDown:function(a,b){b.preventDefault();var d=b.pageX||b.originalEvent.touches&&b.originalEvent.touches[0].pageX;2!==b.button&&("both"===a&&this.setTempMinInterval(),a||(a=this.target||"from"),this.current_plugin=this.plugin_count,this.target=a,this.dragging=this.is_active=!0,this.coords.x_gap=this.$cache.rs.offset().left,this.coords.x_pointer=d-this.coords.x_gap,this.calcPointerPercent(),this.changeLevel(a),m&&f("*").prop("unselectable",
!0),this.$cache.line.trigger("focus"),this.updateScene())},pointerClick:function(a,b){b.preventDefault();var d=b.pageX||b.originalEvent.touches&&b.originalEvent.touches[0].pageX;2!==b.button&&(this.current_plugin=this.plugin_count,this.target=a,this.is_click=!0,this.coords.x_gap=this.$cache.rs.offset().left,this.coords.x_pointer=+(d-this.coords.x_gap).toFixed(),this.force_redraw=!0,this.calc(),this.$cache.line.trigger("focus"))},key:function(a,b){if(!(this.current_plugin!==this.plugin_count||b.altKey||
b.ctrlKey||b.shiftKey||b.metaKey)){switch(b.which){case 83:case 65:case 40:case 37:b.preventDefault();this.moveByKey(!1);break;case 87:case 68:case 38:case 39:b.preventDefault(),this.moveByKey(!0)}return!0}},moveByKey:function(a){var b=this.coords.p_pointer,d=(this.options.max-this.options.min)/100,d=this.options.step/d;this.coords.x_pointer=this.toFixed(this.coords.w_rs/100*(a?b+d:b-d));this.is_key=!0;this.calc()},setMinMax:function(){if(this.options)if(this.options.hide_min_max)this.$cache.min[0].style.display=
"none",this.$cache.max[0].style.display="none";else{if(this.options.values.length)this.$cache.min.html(this.decorate(this.options.p_values[this.options.min])),this.$cache.max.html(this.decorate(this.options.p_values[this.options.max]));else{var a=this._prettify(this.options.min),b=this._prettify(this.options.max);this.result.min_pretty=a;this.result.max_pretty=b;this.$cache.min.html(this.decorate(a,this.options.min));this.$cache.max.html(this.decorate(b,this.options.max))}this.labels.w_min=this.$cache.min.outerWidth(!1);
this.labels.w_max=this.$cache.max.outerWidth(!1)}},setTempMinInterval:function(){var a=this.result.to-this.result.from;null===this.old_min_interval&&(this.old_min_interval=this.options.min_interval);this.options.min_interval=a},restoreOriginalMinInterval:function(){null!==this.old_min_interval&&(this.options.min_interval=this.old_min_interval,this.old_min_interval=null)},calc:function(a){if(this.options){this.calc_count++;if(10===this.calc_count||a)this.calc_count=0,this.coords.w_rs=this.$cache.rs.outerWidth(!1),
this.calcHandlePercent();if(this.coords.w_rs){this.calcPointerPercent();a=this.getHandleX();"both"===this.target&&(this.coords.p_gap=0,a=this.getHandleX());"click"===this.target&&(this.coords.p_gap=this.coords.p_handle/2,a=this.getHandleX(),this.target=this.options.drag_interval?"both_one":this.chooseHandle(a));switch(this.target){case "base":var b=(this.options.max-this.options.min)/100;a=(this.result.from-this.options.min)/b;b=(this.result.to-this.options.min)/b;this.coords.p_single_real=this.toFixed(a);
this.coords.p_from_real=this.toFixed(a);this.coords.p_to_real=this.toFixed(b);this.coords.p_single_real=this.checkDiapason(this.coords.p_single_real,this.options.from_min,this.options.from_max);this.coords.p_from_real=this.checkDiapason(this.coords.p_from_real,this.options.from_min,this.options.from_max);this.coords.p_to_real=this.checkDiapason(this.coords.p_to_real,this.options.to_min,this.options.to_max);this.coords.p_single_fake=this.convertToFakePercent(this.coords.p_single_real);this.coords.p_from_fake=
this.convertToFakePercent(this.coords.p_from_real);this.coords.p_to_fake=this.convertToFakePercent(this.coords.p_to_real);this.target=null;break;case "single":if(this.options.from_fixed)break;this.coords.p_single_real=this.convertToRealPercent(a);this.coords.p_single_real=this.calcWithStep(this.coords.p_single_real);this.coords.p_single_real=this.checkDiapason(this.coords.p_single_real,this.options.from_min,this.options.from_max);this.coords.p_single_fake=this.convertToFakePercent(this.coords.p_single_real);
break;case "from":if(this.options.from_fixed)break;this.coords.p_from_real=this.convertToRealPercent(a);this.coords.p_from_real=this.calcWithStep(this.coords.p_from_real);this.coords.p_from_real>this.coords.p_to_real&&(this.coords.p_from_real=this.coords.p_to_real);this.coords.p_from_real=this.checkDiapason(this.coords.p_from_real,this.options.from_min,this.options.from_max);this.coords.p_from_real=this.checkMinInterval(this.coords.p_from_real,this.coords.p_to_real,"from");this.coords.p_from_real=
this.checkMaxInterval(this.coords.p_from_real,this.coords.p_to_real,"from");this.coords.p_from_fake=this.convertToFakePercent(this.coords.p_from_real);break;case "to":if(this.options.to_fixed)break;this.coords.p_to_real=this.convertToRealPercent(a);this.coords.p_to_real=this.calcWithStep(this.coords.p_to_real);this.coords.p_to_real<this.coords.p_from_real&&(this.coords.p_to_real=this.coords.p_from_real);this.coords.p_to_real=this.checkDiapason(this.coords.p_to_real,this.options.to_min,this.options.to_max);
this.coords.p_to_real=this.checkMinInterval(this.coords.p_to_real,this.coords.p_from_real,"to");this.coords.p_to_real=this.checkMaxInterval(this.coords.p_to_real,this.coords.p_from_real,"to");this.coords.p_to_fake=this.convertToFakePercent(this.coords.p_to_real);break;case "both":if(this.options.from_fixed||this.options.to_fixed)break;a=this.toFixed(a+.001*this.coords.p_handle);this.coords.p_from_real=this.convertToRealPercent(a)-this.coords.p_gap_left;this.coords.p_from_real=this.calcWithStep(this.coords.p_from_real);
this.coords.p_from_real=this.checkDiapason(this.coords.p_from_real,this.options.from_min,this.options.from_max);this.coords.p_from_real=this.checkMinInterval(this.coords.p_from_real,this.coords.p_to_real,"from");this.coords.p_from_fake=this.convertToFakePercent(this.coords.p_from_real);this.coords.p_to_real=this.convertToRealPercent(a)+this.coords.p_gap_right;this.coords.p_to_real=this.calcWithStep(this.coords.p_to_real);this.coords.p_to_real=this.checkDiapason(this.coords.p_to_real,this.options.to_min,
this.options.to_max);this.coords.p_to_real=this.checkMinInterval(this.coords.p_to_real,this.coords.p_from_real,"to");this.coords.p_to_fake=this.convertToFakePercent(this.coords.p_to_real);break;case "both_one":if(!this.options.from_fixed&&!this.options.to_fixed){var d=this.convertToRealPercent(a);a=this.result.to_percent-this.result.from_percent;var c=a/2,b=d-c,d=d+c;0>b&&(b=0,d=b+a);100<d&&(d=100,b=d-a);this.coords.p_from_real=this.calcWithStep(b);this.coords.p_from_real=this.checkDiapason(this.coords.p_from_real,
this.options.from_min,this.options.from_max);this.coords.p_from_fake=this.convertToFakePercent(this.coords.p_from_real);this.coords.p_to_real=this.calcWithStep(d);this.coords.p_to_real=this.checkDiapason(this.coords.p_to_real,this.options.to_min,this.options.to_max);this.coords.p_to_fake=this.convertToFakePercent(this.coords.p_to_real)}}"single"===this.options.type?(this.coords.p_bar_x=this.coords.p_handle/2,this.coords.p_bar_w=this.coords.p_single_fake,this.result.from_percent=this.coords.p_single_real,
this.result.from=this.convertToValue(this.coords.p_single_real),this.result.from_pretty=this._prettify(this.result.from),this.options.values.length&&(this.result.from_value=this.options.values[this.result.from])):(this.coords.p_bar_x=this.toFixed(this.coords.p_from_fake+this.coords.p_handle/2),this.coords.p_bar_w=this.toFixed(this.coords.p_to_fake-this.coords.p_from_fake),this.result.from_percent=this.coords.p_from_real,this.result.from=this.convertToValue(this.coords.p_from_real),this.result.from_pretty=
this._prettify(this.result.from),this.result.to_percent=this.coords.p_to_real,this.result.to=this.convertToValue(this.coords.p_to_real),this.result.to_pretty=this._prettify(this.result.to),this.options.values.length&&(this.result.from_value=this.options.values[this.result.from],this.result.to_value=this.options.values[this.result.to]));this.calcMinMax();this.calcLabels()}}},calcPointerPercent:function(){this.coords.w_rs?(0>this.coords.x_pointer||isNaN(this.coords.x_pointer)?this.coords.x_pointer=
0:this.coords.x_pointer>this.coords.w_rs&&(this.coords.x_pointer=this.coords.w_rs),this.coords.p_pointer=this.toFixed(this.coords.x_pointer/this.coords.w_rs*100)):this.coords.p_pointer=0},convertToRealPercent:function(a){return a/(100-this.coords.p_handle)*100},convertToFakePercent:function(a){return a/100*(100-this.coords.p_handle)},getHandleX:function(){var a=100-this.coords.p_handle,b=this.toFixed(this.coords.p_pointer-this.coords.p_gap);0>b?b=0:b>a&&(b=a);return b},calcHandlePercent:function(){this.coords.w_handle=
"single"===this.options.type?this.$cache.s_single.outerWidth(!1):this.$cache.s_from.outerWidth(!1);this.coords.p_handle=this.toFixed(this.coords.w_handle/this.coords.w_rs*100)},chooseHandle:function(a){return"single"===this.options.type?"single":a>=this.coords.p_from_real+(this.coords.p_to_real-this.coords.p_from_real)/2?this.options.to_fixed?"from":"to":this.options.from_fixed?"to":"from"},calcMinMax:function(){this.coords.w_rs&&(this.labels.p_min=this.labels.w_min/this.coords.w_rs*100,this.labels.p_max=
this.labels.w_max/this.coords.w_rs*100)},calcLabels:function(){this.coords.w_rs&&!this.options.hide_from_to&&("single"===this.options.type?(this.labels.w_single=this.$cache.single.outerWidth(!1),this.labels.p_single_fake=this.labels.w_single/this.coords.w_rs*100,this.labels.p_single_left=this.coords.p_single_fake+this.coords.p_handle/2-this.labels.p_single_fake/2):(this.labels.w_from=this.$cache.from.outerWidth(!1),this.labels.p_from_fake=this.labels.w_from/this.coords.w_rs*100,this.labels.p_from_left=
this.coords.p_from_fake+this.coords.p_handle/2-this.labels.p_from_fake/2,this.labels.p_from_left=this.toFixed(this.labels.p_from_left),this.labels.p_from_left=this.checkEdges(this.labels.p_from_left,this.labels.p_from_fake),this.labels.w_to=this.$cache.to.outerWidth(!1),this.labels.p_to_fake=this.labels.w_to/this.coords.w_rs*100,this.labels.p_to_left=this.coords.p_to_fake+this.coords.p_handle/2-this.labels.p_to_fake/2,this.labels.p_to_left=this.toFixed(this.labels.p_to_left),this.labels.p_to_left=
this.checkEdges(this.labels.p_to_left,this.labels.p_to_fake),this.labels.w_single=this.$cache.single.outerWidth(!1),this.labels.p_single_fake=this.labels.w_single/this.coords.w_rs*100,this.labels.p_single_left=(this.labels.p_from_left+this.labels.p_to_left+this.labels.p_to_fake)/2-this.labels.p_single_fake/2,this.labels.p_single_left=this.toFixed(this.labels.p_single_left)),this.labels.p_single_left=this.checkEdges(this.labels.p_single_left,this.labels.p_single_fake))},updateScene:function(){this.raf_id&&
(cancelAnimationFrame(this.raf_id),this.raf_id=null);clearTimeout(this.update_tm);this.update_tm=null;this.options&&(this.drawHandles(),this.is_active?this.raf_id=requestAnimationFrame(this.updateScene.bind(this)):this.update_tm=setTimeout(this.updateScene.bind(this),300))},drawHandles:function(){this.coords.w_rs=this.$cache.rs.outerWidth(!1);if(this.coords.w_rs){this.coords.w_rs!==this.coords.w_rs_old&&(this.target="base",this.is_resize=!0);if(this.coords.w_rs!==this.coords.w_rs_old||this.force_redraw)this.setMinMax(),
this.calc(!0),this.drawLabels(),this.options.grid&&(this.calcGridMargin(),this.calcGridLabels()),this.force_redraw=!0,this.coords.w_rs_old=this.coords.w_rs,this.drawShadow();if(this.coords.w_rs&&(this.dragging||this.force_redraw||this.is_key)){if(this.old_from!==this.result.from||this.old_to!==this.result.to||this.force_redraw||this.is_key){this.drawLabels();this.$cache.bar[0].style.left=this.coords.p_bar_x+"%";this.$cache.bar[0].style.width=this.coords.p_bar_w+"%";if("single"===this.options.type)this.$cache.s_single[0].style.left=
this.coords.p_single_fake+"%";else{this.$cache.s_from[0].style.left=this.coords.p_from_fake+"%";this.$cache.s_to[0].style.left=this.coords.p_to_fake+"%";if(this.old_from!==this.result.from||this.force_redraw)this.$cache.from[0].style.left=this.labels.p_from_left+"%";if(this.old_to!==this.result.to||this.force_redraw)this.$cache.to[0].style.left=this.labels.p_to_left+"%"}this.$cache.single[0].style.left=this.labels.p_single_left+"%";this.writeToInput();this.old_from===this.result.from&&this.old_to===
this.result.to||this.is_start||(this.$cache.input.trigger("change"),this.$cache.input.trigger("input"));this.old_from=this.result.from;this.old_to=this.result.to;this.is_resize||this.is_update||this.is_start||this.is_finish||this.callOnChange();if(this.is_key||this.is_click)this.is_click=this.is_key=!1,this.callOnFinish();this.is_finish=this.is_resize=this.is_update=!1}this.force_redraw=this.is_click=this.is_key=this.is_start=!1}}},drawLabels:function(){if(this.options){var a=this.options.values.length,
b=this.options.p_values;if(!this.options.hide_from_to)if("single"===this.options.type){if(a)a=this.decorate(b[this.result.from]);else{var d=this._prettify(this.result.from);a=this.decorate(d,this.result.from)}this.$cache.single.html(a);this.calcLabels();this.$cache.min[0].style.visibility=this.labels.p_single_left<this.labels.p_min+1?"hidden":"visible";this.$cache.max[0].style.visibility=this.labels.p_single_left+this.labels.p_single_fake>100-this.labels.p_max-1?"hidden":"visible"}else{a?(this.options.decorate_both?
(a=this.decorate(b[this.result.from]),a+=this.options.values_separator,a+=this.decorate(b[this.result.to])):a=this.decorate(b[this.result.from]+this.options.values_separator+b[this.result.to]),d=this.decorate(b[this.result.from]),b=this.decorate(b[this.result.to])):(d=this._prettify(this.result.from),b=this._prettify(this.result.to),this.options.decorate_both?(a=this.decorate(d,this.result.from),a+=this.options.values_separator,a+=this.decorate(b,this.result.to)):a=this.decorate(d+this.options.values_separator+
b,this.result.to),d=this.decorate(d,this.result.from),b=this.decorate(b,this.result.to));this.$cache.single.html(a);this.$cache.from.html(d);this.$cache.to.html(b);this.calcLabels();a=Math.min(this.labels.p_single_left,this.labels.p_from_left);d=this.labels.p_single_left+this.labels.p_single_fake;var b=this.labels.p_to_left+this.labels.p_to_fake,c=Math.max(d,b);this.labels.p_from_left+this.labels.p_from_fake>=this.labels.p_to_left?(this.$cache.from[0].style.visibility="hidden",this.$cache.to[0].style.visibility=
"hidden",this.$cache.single[0].style.visibility="visible",this.result.from===this.result.to?("from"===this.target?this.$cache.from[0].style.visibility="visible":"to"===this.target?this.$cache.to[0].style.visibility="visible":this.target||(this.$cache.from[0].style.visibility="visible"),this.$cache.single[0].style.visibility="hidden",c=b):(this.$cache.from[0].style.visibility="hidden",this.$cache.to[0].style.visibility="hidden",this.$cache.single[0].style.visibility="visible",c=Math.max(d,b))):(this.$cache.from[0].style.visibility=
"visible",this.$cache.to[0].style.visibility="visible",this.$cache.single[0].style.visibility="hidden");this.$cache.min[0].style.visibility=a<this.labels.p_min+1?"hidden":"visible";this.$cache.max[0].style.visibility=c>100-this.labels.p_max-1?"hidden":"visible"}}},drawShadow:function(){var a=this.options,b=this.$cache,d="number"===typeof a.from_min&&!isNaN(a.from_min),c="number"===typeof a.from_max&&!isNaN(a.from_max),e="number"===typeof a.to_min&&!isNaN(a.to_min),g="number"===typeof a.to_max&&!isNaN(a.to_max);
"single"===a.type?a.from_shadow&&(d||c)?(d=this.convertToPercent(d?a.from_min:a.min),c=this.convertToPercent(c?a.from_max:a.max)-d,d=this.toFixed(d-this.coords.p_handle/100*d),c=this.toFixed(c-this.coords.p_handle/100*c),d+=this.coords.p_handle/2,b.shad_single[0].style.display="block",b.shad_single[0].style.left=d+"%",b.shad_single[0].style.width=c+"%"):b.shad_single[0].style.display="none":(a.from_shadow&&(d||c)?(d=this.convertToPercent(d?a.from_min:a.min),c=this.convertToPercent(c?a.from_max:a.max)-
d,d=this.toFixed(d-this.coords.p_handle/100*d),c=this.toFixed(c-this.coords.p_handle/100*c),d+=this.coords.p_handle/2,b.shad_from[0].style.display="block",b.shad_from[0].style.left=d+"%",b.shad_from[0].style.width=c+"%"):b.shad_from[0].style.display="none",a.to_shadow&&(e||g)?(e=this.convertToPercent(e?a.to_min:a.min),a=this.convertToPercent(g?a.to_max:a.max)-e,e=this.toFixed(e-this.coords.p_handle/100*e),a=this.toFixed(a-this.coords.p_handle/100*a),e+=this.coords.p_handle/2,b.shad_to[0].style.display=
"block",b.shad_to[0].style.left=e+"%",b.shad_to[0].style.width=a+"%"):b.shad_to[0].style.display="none")},writeToInput:function(){"single"===this.options.type?(this.options.values.length?this.$cache.input.prop("value",this.result.from_value):this.$cache.input.prop("value",this.result.from),this.$cache.input.data("from",this.result.from)):(this.options.values.length?this.$cache.input.prop("value",this.result.from_value+this.options.input_values_separator+this.result.to_value):this.$cache.input.prop("value",
this.result.from+this.options.input_values_separator+this.result.to),this.$cache.input.data("from",this.result.from),this.$cache.input.data("to",this.result.to))},callOnStart:function(){this.writeToInput();if(this.options.onStart&&"function"===typeof this.options.onStart)if(this.options.scope)this.options.onStart.call(this.options.scope,this.result);else this.options.onStart(this.result)},callOnChange:function(){this.writeToInput();if(this.options.onChange&&"function"===typeof this.options.onChange)if(this.options.scope)this.options.onChange.call(this.options.scope,
this.result);else this.options.onChange(this.result)},callOnFinish:function(){this.writeToInput();if(this.options.onFinish&&"function"===typeof this.options.onFinish)if(this.options.scope)this.options.onFinish.call(this.options.scope,this.result);else this.options.onFinish(this.result)},callOnUpdate:function(){this.writeToInput();if(this.options.onUpdate&&"function"===typeof this.options.onUpdate)if(this.options.scope)this.options.onUpdate.call(this.options.scope,this.result);else this.options.onUpdate(this.result)},
toggleInput:function(){this.$cache.input.toggleClass("irs-hidden-input");this.has_tab_index?this.$cache.input.prop("tabindex",-1):this.$cache.input.removeProp("tabindex");this.has_tab_index=!this.has_tab_index},convertToPercent:function(a,b){var d=this.options.max-this.options.min;return d?this.toFixed((b?a:a-this.options.min)/(d/100)):(this.no_diapason=!0,0)},convertToValue:function(a){var b=this.options.min,d=this.options.max,c=b.toString().split(".")[1],e=d.toString().split(".")[1],g,l,f=0,h=0;
if(0===a)return this.options.min;if(100===a)return this.options.max;c&&(f=g=c.length);e&&(f=l=e.length);g&&l&&(f=g>=l?g:l);0>b&&(h=Math.abs(b),b=+(b+h).toFixed(f),d=+(d+h).toFixed(f));a=(d-b)/100*a+b;(b=this.options.step.toString().split(".")[1])?a=+a.toFixed(b.length):(a/=this.options.step,a*=this.options.step,a=+a.toFixed(0));h&&(a-=h);h=b?+a.toFixed(b.length):this.toFixed(a);h<this.options.min?h=this.options.min:h>this.options.max&&(h=this.options.max);return h},calcWithStep:function(a){var b=
Math.round(a/this.coords.p_step)*this.coords.p_step;100<b&&(b=100);100===a&&(b=100);return this.toFixed(b)},checkMinInterval:function(a,b,d){var c=this.options;if(!c.min_interval)return a;a=this.convertToValue(a);b=this.convertToValue(b);"from"===d?b-a<c.min_interval&&(a=b-c.min_interval):a-b<c.min_interval&&(a=b+c.min_interval);return this.convertToPercent(a)},checkMaxInterval:function(a,b,d){var c=this.options;if(!c.max_interval)return a;a=this.convertToValue(a);b=this.convertToValue(b);"from"===
d?b-a>c.max_interval&&(a=b-c.max_interval):a-b>c.max_interval&&(a=b+c.max_interval);return this.convertToPercent(a)},checkDiapason:function(a,b,d){a=this.convertToValue(a);var c=this.options;"number"!==typeof b&&(b=c.min);"number"!==typeof d&&(d=c.max);a<b&&(a=b);a>d&&(a=d);return this.convertToPercent(a)},toFixed:function(a){a=a.toFixed(20);return+a},_prettify:function(a){return this.options.prettify_enabled?this.options.prettify&&"function"===typeof this.options.prettify?this.options.prettify(a):
this.prettify(a):a},prettify:function(a){return a.toString().replace(/(\d{1,3}(?=(?:\d\d\d)+(?!\d)))/g,"$1"+this.options.prettify_separator)},checkEdges:function(a,b){if(!this.options.force_edges)return this.toFixed(a);0>a?a=0:a>100-b&&(a=100-b);return this.toFixed(a)},validate:function(){var a=this.options,b=this.result,d=a.values,c=d.length,e;"string"===typeof a.min&&(a.min=+a.min);"string"===typeof a.max&&(a.max=+a.max);"string"===typeof a.from&&(a.from=+a.from);"string"===typeof a.to&&(a.to=+a.to);
"string"===typeof a.step&&(a.step=+a.step);"string"===typeof a.from_min&&(a.from_min=+a.from_min);"string"===typeof a.from_max&&(a.from_max=+a.from_max);"string"===typeof a.to_min&&(a.to_min=+a.to_min);"string"===typeof a.to_max&&(a.to_max=+a.to_max);"string"===typeof a.grid_num&&(a.grid_num=+a.grid_num);a.max<a.min&&(a.max=a.min);if(c)for(a.p_values=[],a.min=0,a.max=c-1,a.step=1,a.grid_num=a.max,a.grid_snap=!0,e=0;e<c;e++){var g=+d[e];isNaN(g)?g=d[e]:(d[e]=g,g=this._prettify(g));a.p_values.push(g)}if("number"!==
typeof a.from||isNaN(a.from))a.from=a.min;if("number"!==typeof a.to||isNaN(a.to))a.to=a.max;"single"===a.type?(a.from<a.min&&(a.from=a.min),a.from>a.max&&(a.from=a.max)):(a.from<a.min&&(a.from=a.min),a.from>a.max&&(a.from=a.max),a.to<a.min&&(a.to=a.min),a.to>a.max&&(a.to=a.max),this.update_check.from&&(this.update_check.from!==a.from&&a.from>a.to&&(a.from=a.to),this.update_check.to!==a.to&&a.to<a.from&&(a.to=a.from)),a.from>a.to&&(a.from=a.to),a.to<a.from&&(a.to=a.from));if("number"!==typeof a.step||
isNaN(a.step)||!a.step||0>a.step)a.step=1;"number"===typeof a.from_min&&a.from<a.from_min&&(a.from=a.from_min);"number"===typeof a.from_max&&a.from>a.from_max&&(a.from=a.from_max);"number"===typeof a.to_min&&a.to<a.to_min&&(a.to=a.to_min);"number"===typeof a.to_max&&a.from>a.to_max&&(a.to=a.to_max);if(b){b.min!==a.min&&(b.min=a.min);b.max!==a.max&&(b.max=a.max);if(b.from<b.min||b.from>b.max)b.from=a.from;if(b.to<b.min||b.to>b.max)b.to=a.to}if("number"!==typeof a.min_interval||isNaN(a.min_interval)||
!a.min_interval||0>a.min_interval)a.min_interval=0;if("number"!==typeof a.max_interval||isNaN(a.max_interval)||!a.max_interval||0>a.max_interval)a.max_interval=0;a.min_interval&&a.min_interval>a.max-a.min&&(a.min_interval=a.max-a.min);a.max_interval&&a.max_interval>a.max-a.min&&(a.max_interval=a.max-a.min)},decorate:function(a,b){var d="",c=this.options;c.prefix&&(d+=c.prefix);d+=a;c.max_postfix&&(c.values.length&&a===c.p_values[c.max]?(d+=c.max_postfix,c.postfix&&(d+=" ")):b===c.max&&(d+=c.max_postfix,
c.postfix&&(d+=" ")));c.postfix&&(d+=c.postfix);return d},updateFrom:function(){this.result.from=this.options.from;this.result.from_percent=this.convertToPercent(this.result.from);this.result.from_pretty=this._prettify(this.result.from);this.options.values&&(this.result.from_value=this.options.values[this.result.from])},updateTo:function(){this.result.to=this.options.to;this.result.to_percent=this.convertToPercent(this.result.to);this.result.to_pretty=this._prettify(this.result.to);this.options.values&&
(this.result.to_value=this.options.values[this.result.to])},updateResult:function(){this.result.min=this.options.min;this.result.max=this.options.max;this.updateFrom();this.updateTo()},appendGrid:function(){if(this.options.grid){var a=this.options,b;var d=a.max-a.min;var c=a.grid_num,e=4,g="";this.calcGridMargin();if(a.grid_snap)if(50<d){c=50/a.step;var f=this.toFixed(a.step/.5)}else c=d/a.step,f=this.toFixed(a.step/(d/100));else f=this.toFixed(100/c);4<c&&(e=3);7<c&&(e=2);14<c&&(e=1);28<c&&(e=0);
for(d=0;d<c+1;d++){var k=e;var h=this.toFixed(f*d);100<h&&(h=100);this.coords.big[d]=h;var m=(h-f*(d-1))/(k+1);for(b=1;b<=k&&0!==h;b++){var n=this.toFixed(h-m*b);g+='<span class="irs-grid-pol small" style="left: '+n+'%"></span>'}g+='<span class="irs-grid-pol" style="left: '+h+'%"></span>';b=this.convertToValue(h);b=a.values.length?a.p_values[b]:this._prettify(b);g+='<span class="irs-grid-text js-grid-text-'+d+'" style="left: '+h+'%">'+b+"</span>"}this.coords.big_num=Math.ceil(c+1);this.$cache.cont.addClass("irs-with-grid");
this.$cache.grid.html(g);this.cacheGridLabels()}},cacheGridLabels:function(){var a,b=this.coords.big_num;for(a=0;a<b;a++){var d=this.$cache.grid.find(".js-grid-text-"+a);this.$cache.grid_labels.push(d)}this.calcGridLabels()},calcGridLabels:function(){var a;var b=[];var d=[],c=this.coords.big_num;for(a=0;a<c;a++)this.coords.big_w[a]=this.$cache.grid_labels[a].outerWidth(!1),this.coords.big_p[a]=this.toFixed(this.coords.big_w[a]/this.coords.w_rs*100),this.coords.big_x[a]=this.toFixed(this.coords.big_p[a]/
2),b[a]=this.toFixed(this.coords.big[a]-this.coords.big_x[a]),d[a]=this.toFixed(b[a]+this.coords.big_p[a]);this.options.force_edges&&(b[0]<-this.coords.grid_gap&&(b[0]=-this.coords.grid_gap,d[0]=this.toFixed(b[0]+this.coords.big_p[0]),this.coords.big_x[0]=this.coords.grid_gap),d[c-1]>100+this.coords.grid_gap&&(d[c-1]=100+this.coords.grid_gap,b[c-1]=this.toFixed(d[c-1]-this.coords.big_p[c-1]),this.coords.big_x[c-1]=this.toFixed(this.coords.big_p[c-1]-this.coords.grid_gap)));this.calcGridCollision(2,
b,d);this.calcGridCollision(4,b,d);for(a=0;a<c;a++)b=this.$cache.grid_labels[a][0],this.coords.big_x[a]!==Number.POSITIVE_INFINITY&&(b.style.marginLeft=-this.coords.big_x[a]+"%")},calcGridCollision:function(a,b,d){var c,e=this.coords.big_num;for(c=0;c<e;c+=a){var g=c+a/2;if(g>=e)break;var f=this.$cache.grid_labels[g][0];f.style.visibility=d[c]<=b[g]?"visible":"hidden"}},calcGridMargin:function(){this.options.grid_margin&&(this.coords.w_rs=this.$cache.rs.outerWidth(!1),this.coords.w_rs&&(this.coords.w_handle=
"single"===this.options.type?this.$cache.s_single.outerWidth(!1):this.$cache.s_from.outerWidth(!1),this.coords.p_handle=this.toFixed(this.coords.w_handle/this.coords.w_rs*100),this.coords.grid_gap=this.toFixed(this.coords.p_handle/2-.1),this.$cache.grid[0].style.width=this.toFixed(100-this.coords.p_handle)+"%",this.$cache.grid[0].style.left=this.coords.grid_gap+"%"))},update:function(a){this.input&&(this.is_update=!0,this.options.from=this.result.from,this.options.to=this.result.to,this.update_check.from=
this.result.from,this.update_check.to=this.result.to,this.options=f.extend(this.options,a),this.validate(),this.updateResult(a),this.toggleInput(),this.remove(),this.init(!0))},reset:function(){this.input&&(this.updateResult(),this.update())},destroy:function(){this.input&&(this.toggleInput(),this.$cache.input.prop("readonly",!1),f.data(this.input,"ionRangeSlider",null),this.remove(),this.options=this.input=null)}};f.fn.ionRangeSlider=function(a){return this.each(function(){f.data(this,"ionRangeSlider")||
f.data(this,"ionRangeSlider",new q(this,a,t++))})};(function(){for(var a=0,b=["ms","moz","webkit","o"],d=0;d<b.length&&!k.requestAnimationFrame;++d)k.requestAnimationFrame=k[b[d]+"RequestAnimationFrame"],k.cancelAnimationFrame=k[b[d]+"CancelAnimationFrame"]||k[b[d]+"CancelRequestAnimationFrame"];k.requestAnimationFrame||(k.requestAnimationFrame=function(b,d){var c=(new Date).getTime(),e=Math.max(0,16-(c-a)),f=k.setTimeout(function(){b(c+e)},e);a=c+e;return f});k.cancelAnimationFrame||(k.cancelAnimationFrame=
function(a){clearTimeout(a)})})()});


/*-- custom.js----*/


function snfHasClass(el, className) {
  if (el.classList)
    return el.classList.contains(className)
  else
    return !!el.className.match(new RegExp('(\\s|^)' + className + '(\\s|$)'))
}

function snfAddClass(el, className) {
  if (el.classList)
    el.classList.add(className)
  else if (!hasClass(el, className)) el.className += " " + className
}

function snfRemoveClass(el, className) {
  if (el.classList)
    el.classList.remove(className)
  else if (hasClass(el, className)) {
    var reg = new RegExp('(\\s|^)' + className + '(\\s|$)')
    el.className=el.className.replace(reg, ' ')
  }
}

// ----- model ------

/*------ Unit switch --------*/

var snfswitch = document.querySelectorAll('.snf5342-widget-unit-switch');
for (var i = 0; i < snfswitch.length; i++) { 

  snfswitch[i].onclick = function() {
      var className = ' ' + this.className + ' ';
       var snfTableList = document.querySelectorAll('[data-snfOriginal]');
       console.log("snfTableList"+snfTableList);

      if ( ~className.indexOf(' snf5342-widget-unit-switch-on ') ) {
          this.className = className.replace(' snf5342-widget-unit-switch-on ', ' ');
          for (var i = 0; i < snfTableList.length; i++) { 
            var InchVal = snfTableList[i].getAttribute('data-snfOriginal');
            snfTableList[i].innerHTML = InchVal;
      };  
      } else {
          this.className += ' snf5342-widget-unit-switch-on';
          for (var i = 0; i < snfTableList.length; i++) { 
            var InchVal = snfTableList[i].getAttribute('data-snfOriginal');
            var CmVal = InchVal * 2.54;
            snfTableList[i].innerHTML = Math.round(CmVal * 2) / 2;
      }; 
      }
  }
}



// ft cm and kg lb selection

var heightUnitSelect = new snfSelect('#snf5342-widget-select-height-unit');
var weightUnitSelect = new snfSelect('#snf5342-widget-select-weight-unit');


var height_element = document.querySelectorAll('.snf5342-widget-select-height-filter ul li');
for (var i=0; i<height_element.length; i++) {
    height_element[i].onclick = function() {        
        var huVal = this.getAttribute('data-value'),
            ftItem = document.getElementById('snf5342-widget-select-item-ft'),
            cmItem = document.getElementById('snf5342-widget-select-item-cm'),
            ftSlider = document.getElementById('snf5342-widget-select-slider-height-ft'),
            cmSlider = document.getElementById('snf5342-widget-select-slider-height-cm'),
            sliderFt = document.getElementById("snf5342-widget-select-slider-ft"),
            sliderCm = document.getElementById("snf5342-widget-select-slider-cm"),
            slider_value;

        if(huVal == 'cm'){

            range2.ionRangeSlider({
                hide_min_max: true,
                hide_from_to : true,
                min: min2,
                max: max2,
                value: value2,
                from: value2,
                step: 2,
                // onStart: updateInputs2,
                onChange: updateInputs2
            });

            snfAddClass(cmItem, 'snf5342-widget-select-item-active');
            snfRemoveClass(ftItem, 'snf5342-widget-select-item-active');
            snfAddClass(cmSlider, 'snf5342-widget-select-item-active');
            snfRemoveClass(ftSlider, 'snf5342-widget-select-item-active');

            
            slider_value = parseInt(sliderFt.value);
            console.log(slider_value);

            slider_value = convertHtWt(slider_value,huVal);
            console.log("Converted Cm value"+slider_value);
            modifyslider(sliderCm,slider_value);
        }
        if(huVal == 'ft'){
            snfAddClass(ftItem, 'snf5342-widget-select-item-active');
            snfRemoveClass(cmItem, 'snf5342-widget-select-item-active');
            snfAddClass(ftSlider, 'snf5342-widget-select-item-active');
            snfRemoveClass(cmSlider, 'snf5342-widget-select-item-active');
            
            slider_value = parseInt(sliderCm.value);
            console.log(slider_value);

            slider_value = convertHtWt(slider_value,huVal);
            console.log("Converted Ft value"+slider_value);
            modifyslider(sliderFt,slider_value);
        }
    }
}

var width_element = document.querySelectorAll('.snf5342-widget-select-weight-filter ul li');
for (var i=0; i<width_element.length; i++) {
    width_element[i].onclick = function() {
        var huVal = this.getAttribute('data-value'),
            kgItem = document.getElementById('snf5342-widget-select-item-kg'),
            lbItem = document.getElementById('snf5342-widget-select-item-lb'),
            kgSlider = document.getElementById('snf5342-widget-select-slider-weight-kg'),
            lbSlider = document.getElementById('snf5342-widget-select-slider-weight-lb'),
            sliderKg = document.getElementById("snf5342-widget-select-slider-kg"),
            sliderLb = document.getElementById("snf5342-widget-select-slider-lb"),
            slider_value;

        if(huVal == 'lb'){

        	range1.ionRangeSlider({
			    hide_min_max: true,
			    hide_from_to : true,
			    min: min1,
			    max: max1,
			    value: value1,
			    from: value1,
			    step: step1,
			    // onStart: updateInputs1,
			    onChange: updateInputs1
			});

            // range3.ionRangeSlider({
            //     hide_min_max: true,
            //     hide_from_to : true,
            //     min: min3,
            //     max: max3,
            //     value : value3,
            //     from: value3,
            //     step: 2,
            //     // onStart: updateInputs3,
            //     onChange: updateInputs3
            // });

            snfAddClass(lbItem, 'snf5342-widget-select-item-active');
            snfRemoveClass(kgItem, 'snf5342-widget-select-item-active');
            snfAddClass(lbSlider, 'snf5342-widget-select-item-active');
            snfRemoveClass(kgSlider, 'snf5342-widget-select-item-active');
            

            slider_value = parseInt(sliderKg.value);
            console.log(slider_value);

            slider_value = convertHtWt(slider_value,huVal);
            console.log("Converted Lb value"+slider_value);
            modifyslider(sliderLb,slider_value);
        }
        if(huVal == 'kg'){
            snfAddClass(kgItem, 'snf5342-widget-select-item-active');
            snfRemoveClass(lbItem, 'snf5342-widget-select-item-active');
            snfAddClass(kgSlider, 'snf5342-widget-select-item-active');
            snfRemoveClass(lbSlider, 'snf5342-widget-select-item-active');
            
            slider_value = parseInt(sliderLb.value);
            console.log(slider_value);

            slider_value = convertHtWt(slider_value , huVal);
            console.log("Converted kg value"+slider_value);
            modifyslider(sliderKg,slider_value);
        }
    }
}


// get weight value from lb to cms
function convertHtWt(value , unit){
    console.log("In converting height and weight:-" + value +"----" +unit);
    var htConstantFt = 2.54 , wtConstantKg = 2.20462;
    var htConstantCm = 0.393701 , wtConstantLb = 0.453592;
    var temp;

                                if(unit == 'ft'){
                                    temp = value * htConstantCm;
                                    value = Math.floor(temp);
                                }
                                else if(unit == 'kg'){
                                    temp = value * wtConstantLb;
                                    value = Math.floor(temp);
                                }
                                else if(unit == 'lb'){
                                    temp = value * wtConstantKg;
                                    value = Math.floor(temp);
                                }
                                else if(unit == 'cm'){
                                    temp = value * htConstantFt;
                                    value = Math.floor(temp);
                                }
            return value;
}
//get height
var gh = angular.element(document.getElementById("snf5342-widget-select-height"));
var height111 = gh.scope().getheightnew();

// console.log("Value of 111:-"+_.isUndefined(height111));

if(_.isUndefined(height111)){
    console.log("in null");
    min = document.getElementById('snf5342-widget-select-slider-ft').getAttribute('min');
    console.log(min);
    max = document.getElementById('snf5342-widget-select-slider-ft').getAttribute('max');
    console.log(max);
    min = parseInt(min) + parseInt(max);
    console.log(min);
    height111 = Math.floor(min/2);
    console.log("height Value:-"+height111);
}

//get weight
var gw = angular.element(document.getElementById("snf5342-widget-select-weight"));
var weight111 = gw.scope().getweightnew();

// console.log("Value of 111:-"+_.isUndefined(weight111));

if(_.isUndefined(weight111)){
    console.log("in null");
    min = document.getElementById('snf5342-widget-select-slider-lb').getAttribute('min');
    console.log(min);
    max = document.getElementById('snf5342-widget-select-slider-lb').getAttribute('max');
    console.log(max);
    min = parseInt(min) + parseInt(max);
    console.log(min);
    weight111 = Math.floor(min/2);
    console.log("weight Value:-"+weight111);
}

//For height weight slider

var range1 = jQuery("#snf5342-widget-select-slider-kg"),
    inputFrom1 = jQuery("#snf5342-widget-select-weight"),
    instance1,
    min1 = document.getElementById('snf5342-widget-select-slider-kg').getAttribute('min'),
    max1 = document.getElementById('snf5342-widget-select-slider-kg').getAttribute('max'),
    value1 = weight111,
    step1 = document.getElementById('snf5342-widget-select-slider-kg').getAttribute('step');


//For Height Slider in ft
var range = jQuery("#snf5342-widget-select-slider-ft"),
    inputFrom = jQuery("#snf5342-widget-select-height"),
    inputTo = jQuery("#snf5342-widget-select-height-in"),
    instance,
    min = document.getElementById('snf5342-widget-select-slider-ft').getAttribute('min'),
    max = document.getElementById('snf5342-widget-select-slider-ft').getAttribute('max'),
    value = height111;
    // from = (min+max)/2;

var range3 = jQuery("#snf5342-widget-select-slider-lb"),
    inputFrom3 = jQuery("#snf5342-widget-select-weight-lb"),
    instance3,
    min3 = document.getElementById('snf5342-widget-select-slider-lb').getAttribute('min'),
    max3 = document.getElementById('snf5342-widget-select-slider-lb').getAttribute('max'),
    value3 = document.getElementById('snf5342-widget-select-slider-lb').getAttribute('value');


var range2 = jQuery("#snf5342-widget-select-slider-cm"),
    inputFrom2 = jQuery("#snf5342-widget-select-height-cm"),
    instance2,
    min2 = document.getElementById('snf5342-widget-select-slider-cm').getAttribute('min'),
    max2 = document.getElementById('snf5342-widget-select-slider-cm').getAttribute('max'),
    value2 = document.getElementById('snf5342-widget-select-slider-cm').getAttribute('value');

range1.ionRangeSlider({
			    hide_min_max: true,
			    hide_from_to : true,
			    min: min1,
			    max: max1,
			    value: value1,
			    from: value1,
			    step: step1,
			    // onStart: updateInputs1,
			    onChange: updateInputs1
			});
//range slider for ft and kg
range.ionRangeSlider({
    hide_min_max: true,
    hide_from_to : true,
    min: min,
    max: max,
    value: value,
    from: value,
    step: 1,
    onStart: updateInputs,
    onChange: updateInputs
});
// range1.ionRangeSlider({
//     hide_min_max: true,
//     hide_from_to : true,
//     min: min1,
//     max: max1,
//     value: value1,
//     from: value1,
//     step: step1,
//     onStart: updateInputs1,
//     onChange: updateInputs1
// });

range3.ionRangeSlider({
                hide_min_max: true,
                hide_from_to : true,
                min: min3,
                max: max3,
                value : value1,
                from: value1,
                step: 2,
                onStart: updateInputs3,
                onChange: updateInputs3
            });


//functions to be called on change of slider values
function updateInputs (data) {
    var a =angular.element(document.getElementById("snf5342-widget-select-slider-ft"));
    var unit = 'ft';
    value = data.from;
    //console.log("Value:-" + from);

    var feet =  Math.floor( value / 12);
    inputFrom.prop("value", feet);
    
    
    var inch =  Math.floor( value % 12);
    inputTo.prop("value", inch);

    a.scope().update(value,unit);
}


function updateInputs2 (data) {

    var a3 =angular.element(document.getElementById("snf5342-widget-select-slider-cm"));
    var unit = 'cm';

    value = data.from;
    console.log("Value:-" + value);
    inputFrom2.prop("value", (value) + '-' + (value+1));

    a3.scope().update(value , unit);
}

function updateInputs3 (data) {

    var a2 =angular.element(document.getElementById("snf5342-widget-select-slider-lb"));
    var unit = 'lb';

    value = data.from;
    console.log("Value:-" + value);
    inputFrom3.prop("value", (value) + '-' + (value+1));

    a2.scope().update(value , unit);
}



function updateInputs1 (data) {
    var a1 =angular.element(document.getElementById("snf5342-widget-select-slider-kg"));
    var unit = 'kg';
    // console.log(data.value);
    value = data.from;
    inputFrom1.prop("value", value);

    a1.scope().update(value ,unit);
}


//code for the buttons on the slider
var snfSliderUp = document.querySelectorAll('.snf5342-widget-select-slider-up');
for (var i=0; i<snfSliderUp.length; i++) {
        snfSliderUp[i].addEventListener('click', function (e) {
            var Inslider = document.getElementById(this.getAttribute('data-Slide')),
                step = Inslider.getAttribute('step'),
                max = Inslider.getAttribute('max');

                slider_value = parseInt(Inslider.value) + +step;
                
                
                if(slider_value <= max){
                    modifyslider(Inslider, slider_value);
                }               
        }, false);
}
var snfSliderDown = document.querySelectorAll('.snf5342-widget-select-slider-down');
for (var i=0; i<snfSliderDown.length; i++) {
        snfSliderDown[i].addEventListener('click', function (e) {
            var Inslider = document.getElementById(this.getAttribute('data-Slide')),
                step = Inslider.getAttribute('step'),
                min = Inslider.getAttribute('min');
                
                slider_value = parseInt(Inslider.value) - +step;
                
                if(slider_value >= min){
                    modifyslider(Inslider, slider_value);
                }                
        }, false);
}


function changeSlider(){
     // console.log("In change Slider" + slider_type);
    var sFt = document.getElementById("snf5342-widget-select-slider-ft"),
        sCm = document.getElementById("snf5342-widget-select-slider-cm"),
        sKg = document.getElementById("snf5342-widget-select-slider-kg"),
        sLb = document.getElementById("snf5342-widget-select-slider-lb");

        sFt.min = 20 ;  sFt.max=84;
        sCm.min = 50 ;  sCm.max=213;
        sKg.min = 5  ;  sKg.max =65;
        sLb.min = 11 ;  sLb.max=143;

        console.log("Boy or Girl");
        min = 20; min1 =5 ; min2 =50 ; min3 =11;
        max = 84; max1 =65 ; max2 =213 ; max3 =143;

        var gh = angular.element(document.getElementById("snf5342-widget-select-height"));
        var height11 = gh.scope().getheightnew();
        console.log("height Value:-"+height11);
        if(height11 > max ){
            height11=max;
        }
        if(_.isUndefined(height11)){
            console.log("in null");
            min = min+max;
            height11 = Math.floor(min/2);
            console.log("height Value:-"+height11);
        }
        console.log("height Value:-"+height11);
        //get weight
        var gw = angular.element(document.getElementById("snf5342-widget-select-weight"));
        var weight11 = gw.scope().getweightnew();
        console.log("weight Value:-"+weight11);
        if(weight11 > max1 ){
            weight11=max1;
        }
        if(_.isUndefined(weight11)){
            console.log("in null");
            min = min1 + max1;
            weight11 = Math.floor(min1/2);
            console.log("weight Value:-"+weight11);
        }
        console.log("weight Value:-"+weight11);
        //for kgs
        var slider1 = range1.data("ionRangeSlider");
        slider1.update({
                        min: min1,
                        max: max1,
                        value: weight11,
                        from: weight11
                    });
        var change = document.getElementById("snf5342-widget-select-weight");
        change.value = weight11;

        //for Ft
        var slider = range.data("ionRangeSlider");
        slider.update({
                        min: min,
                        max: max,
                        value: height11,
                        from: height11
                    });
        var f1 = document.getElementById("snf5342-widget-select-height");
                    var i1 = document.getElementById("snf5342-widget-select-height-in");
                    console.log(f1);
                    console.log(i1);

                    var feet =  Math.floor( height11 / 12);
                    var inch =  Math.floor( height11 % 12);
                    console.log("feet" + feet);
                    console.log("inch", inch);

                    f1.value = feet;
                    i1.value = inch;


}

//Code to modify the slider and update the value in the box
function modifyslider(Inslider,slider_value){

    console.log("In modifyslider Function");

    var unit = Inslider.getAttribute('unit'),
        id = Inslider.getAttribute('id'),
        a = angular.element(document.getElementById(id));

                if(unit == 'kg'){
                    var slider = range1.data("ionRangeSlider");
                    
                    slider.update({
                        value: slider_value,
                        from: slider_value
                    });

                    //code to change the value shown in box
                    var change = document.getElementById("snf5342-widget-select-weight");
                    change.value = slider_value;
                }
                else if(unit == 'ft'){
                    var slider = range.data("ionRangeSlider");
                    slider.update({
                        value: slider_value,
                        from: slider_value
                    });


                    //code to change the value shown in box
                    var f1 = document.getElementById("snf5342-widget-select-height");
                    var i1 = document.getElementById("snf5342-widget-select-height-in");
                    console.log(f1);
                    console.log(i1);

                    var feet =  Math.floor( slider_value / 12);
                    var inch =  Math.floor( slider_value % 12);
                    console.log("feet" + feet);
                    console.log("inch", inch);

                    f1.value = feet;
                    i1.value = inch;

                }
                else if(unit == 'cm'){
                    var slider = range2.data("ionRangeSlider");
                    slider.update({
                        value: slider_value,
                        from: slider_value
                    });

                    //code to change the value shown in box
                    var change = document.getElementById("snf5342-widget-select-height-cm");
                    change.value = (slider_value)+'-'+(slider_value+1);
                }
                else if(unit == 'lb'){
                    var slider = range3.data("ionRangeSlider");
                    slider.update({
                        value: slider_value,
                        from: slider_value
                    });

                    //code to change the value shown in box
                    var change = document.getElementById("snf5342-widget-select-weight-lb");
                    change.value = (slider_value)+'-'+(slider_value+1);
                }

    a.scope().update(slider_value, unit);

}





//after selection button enable code

function snfHasChecked(name) {
  var item = document.getElementsByName(name),
      checked = '';
    for (i = 0; i <item.length; i++) {
        if (item[i].checked) {
           checked = item[i].value;
        }
    }
    return checked;
} 

var List1 = document.getElementsByName("snf5342-widget-fit");
for (var i=0; i<List1.length; i++) {
    List1[i].onclick = function() {
        var TabBtn3 = document.getElementById('snf5342-widget-tab-btn-03');
        if(snfHasChecked('snf5342-widget-size')){
            snfRemoveClass(TabBtn3, 'snf5342-widget-toggle-disabled');   
            snfAddClass(TabBtn3, 'snf5342-widget-btn-primary'); 
            snfAddClass(TabBtn3, 'snf5342-widget-btn-primary-filled');
        }
    }
}
var List2 = document.getElementsByName("snf5342-widget-size");
for (var i=0; i<List2.length; i++) {
    List2[i].onclick = function() {
        var TabBtn3 = document.getElementById('snf5342-widget-tab-btn-03');
        if(snfHasChecked('snf5342-widget-fit')){
            snfRemoveClass(TabBtn3, 'snf5342-widget-toggle-disabled');   
            snfAddClass(TabBtn3, 'snf5342-widget-btn-primary'); 
            snfAddClass(TabBtn3, 'snf5342-widget-btn-primary-filled');
        }
    }
}

var List3 = document.getElementsByName("snf5342-widget-dress"); 
for (var i=0; i<List3.length; i++) {
    List3[i].onclick = function() {
        var check = document.getElementById("snf5342-widget-select-height-in");
        var TabBtn5 = document.getElementById('snf5342-widget-tab-result-overlay1');
        //console.log("abc", check.style.color);
        if(check.style.color != 'red'){
            snfRemoveClass(TabBtn5, 'snf5342-widget-toggle-disabled');  
            snfAddClass(TabBtn5, 'snf5342-widget-btn-primary');
            snfAddClass(TabBtn5, 'snf5342-widget-btn-primary-filled');
        }else{
            snfAddClass(TabBtn5, 'snf5342-widget-toggle-disabled');  
            snfRemoveClass(TabBtn5, 'snf5342-widget-btn-primary');
            snfRemoveClass(TabBtn5, 'snf5342-widget-btn-primary-filled');
        }
    }
}


var snfWindowWidth = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
if(snfWindowWidth <= 767){
        var siemaBodyShape = new Siema({
              perPage: 3,
              selector: '.snf5342-widget-body-shape',
            });
        var siemaBodyShapeprev = document.querySelector('.snf5342-widget-body-shape-btn-prev');
var siemaBodyShapenext = document.querySelector('.snf5342-widget-body-shape-btn-next');

siemaBodyShapeprev.addEventListener('click', function() { siemaBodyShape.prev()});
siemaBodyShapenext.addEventListener('click', function() { siemaBodyShape.next()});
    }


var chx = document.querySelectorAll('.snf5342-widget-body-shape-item');
  for (var i=0; i<chx.length; i++) {
   chx[i].onclick = function() {
      var Btn = document.getElementById('snf5342-widget-tab-result-overlay1');
      snfRemoveClass(Btn, 'snf5342-widget-toggle-disabled');   
      snfAddClass(Btn, 'snf5342-widget-btn-primary'); 
      snfAddClass(Btn, 'snf5342-widget-btn-primary-filled'); 
    } 
  }

var BarndInput = document.querySelectorAll('.snf5342-widget-select-brand .snf-widget-select-wrap ul li');
for (var i=0; i<BarndInput.length; i++) {
    BarndInput[i].onclick = function() {
        var TabBtn2 = document.getElementById('snf5342-widget-tab-btn-02');

        snfRemoveClass(TabBtn2, 'snf5342-widget-toggle-disabled');   
      snfAddClass(TabBtn2, 'snf5342-widget-btn-primary'); 
      snfAddClass(TabBtn2, 'snf5342-widget-btn-primary-filled');
    }
}
 
function myfun(){
    var e1 = document.getElementById('ul');
    e1.style.visibility = "visible" ;
    

}

function myfun1(){
    var e1 = document.getElementById('ul');
    e1.style.visibility = "hidden" ;
} 

function drowcircle(){

        /*------- ProgressBar ----------*/
        function snfhexToRgb(hex, alpha) {
            // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
            var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
            hex = hex.replace(shorthandRegex, function(m, r, g, b) {
                return r + r + g + g + b + b;
            });

            var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? {
                r: parseInt(result[1], 16),
                g: parseInt(result[2], 16),
                b: parseInt(result[3], 16),
                a: alpha,
                rgba: 'rgba('+ parseInt(result[1], 16) +', '+ parseInt(result[2], 16) +', '+ parseInt(result[3], 16) +', '+ alpha +')'
            } : null;
        }


        var CircleCanvas = document.querySelectorAll('.snf5342-widget-canvas'); // get canvas

        for (var i = 0; i < CircleCanvas.length; i++) { 
                var options = {
                    percent:  CircleCanvas[i].getAttribute('data-percent') || 25,
                    size: CircleCanvas[i].getAttribute('data-size') || 160,
                    lineWidth: CircleCanvas[i].getAttribute('data-line') || 10,
                    rotate: CircleCanvas[i].getAttribute('data-rotate') || 0,
                    Cstroke: CircleCanvas[i].getAttribute('data-stroke') || 0,
                };
                 //console.log("options.percent",options.percent);
                 console.log("Percent" + options.percent);

                    if(options.percent < 65 && options.percent > 40){          
                        var StrokeColor = '#B6B3B2';
                    }else if(options.percent >= 65 && options.percent < 80){
                        var StrokeColor = '#E19702';
                    }else{
                        var StrokeColor = '#61B500';
                    }


               if(options.percent == 0){
                        var StrokeColor = '#FFF';        
                 }
                 console.log("Check for 0 " + StrokeColor);
                var canvas = document.createElement('canvas');
                var div = document.createElement('div');
                var span = document.createElement('span');
                var innerspan1 = document.createElement('span');
                var innerspan2 = document.createElement('span');
                div.className = "snf5342-widget-canvas-inner";
                span.className = "snf5342-widget-canvas-label";
                div.appendChild(span);
                span.appendChild(innerspan1);
                span.appendChild(innerspan2);
                innerspan2.textContent = options.percent + '%';
                innerspan1.textContent = 'Matches';
                    
                if (typeof(G_vmlCanvasManager) !== 'undefined') {
                    G_vmlCanvasManager.initElement(canvas);
                }
                var ctx = canvas.getContext('2d');
                canvas.width = canvas.height = options.size;
                CircleCanvas[i].appendChild(canvas);
        }
            ctx.translate(options.size / 2, options.size / 2); // change center
            ctx.rotate((-1 / 2 + options.rotate / 180) * Math.PI); // rotate -90 deg
            var radius = (options.size - options.lineWidth) / 2;

            var snfdrawCircle = function(color, lineWidth, percent) {           
                    percent = Math.min(Math.max(0, percent || 1), 1);
                    
                    ctx.beginPath();            
                    ctx.arc(0, 0, radius, 0, Math.PI * 2 * percent, false);
                    ctx.strokeStyle = color;            
                    ctx.lineWidth = lineWidth
                    ctx.stroke();
            };

            var curr = 0,
            circum = Math.PI * 2;
            finish =  parseInt(options.percent);
            snfdrawCircle('#fff',options.lineWidth+2,100/100);
            var pr1 = document.getElementById('pr1');
            var pr  = document.getElementById('pr');
            pr1.style.color = '#fff';
             pr.style.color = '#fff';

            var raf =   window.requestAnimationFrame ||
                        window.mozRequestAnimationFrame ||
                        window.webkitRequestAnimationFrame ||
                        window.msRequestAnimationFrame;
            window.requestAnimationFrame = raf;
    
             var handle = setInterval(function() {
                 pr1.style.color = '#fff';
             pr.style.color = '#fff';
                                    pr.innerHTML = curr  + '%';
                                    curr++;
                                    if(curr < 65){
                                            if(curr==1){
                                                snfdrawCircle(snfhexToRgb('#B6B3B2', 0.2).rgba, options.lineWidth, 100 / 100);
                                            }
                                     var StrokeColor = '#B6B3B2';
                                     pr1.style.color = '#B6B3B2';
                                     pr.style.color = '#B6B3B2';
                                     }else if(curr >= 65 && curr < 85){
                                            if(curr==65){
                                                snfdrawCircle(snfhexToRgb('#E19702', 0.2).rgba, options.lineWidth, 100 / 100);
                                            }
                                       var StrokeColor = '#E19702';
                                       pr1.style.color = '#E19702';
                                        pr.style.color = '#E19702';
                                    }else if(curr >= 85 && curr <= 100){
                                            if(curr==85){
                                                snfdrawCircle(snfhexToRgb('#61B500', 0.2).rgba, options.lineWidth, 100 / 100);
                                            }
                                       var StrokeColor = '#61B500';
                                        pr1.style.color = '#61B500';
                                        pr.style.color = '#61B500';
                                    }
                                   
                                    if(curr > finish || curr >= 100) {
                                        clearInterval(handle);
                                    return; 
                                    }
                    snfdrawCircle(StrokeColor,options.lineWidth,curr/100);          
            }, 10);           
     
}




var barndFit = document.querySelectorAll('.snf5342-widget-fit-list .snf5342-widget-form-check-item'),
    brandparent = document.getElementById('snf5342-widget-fit-list-main')
if(barndFit.length >= 3){
    snfAddClass(brandparent, 'snf5342-widget-has-arrows')
}

var barndSize = document.querySelectorAll('.snf5342-widget-size-list .snf5342-widget-form-check-item'),
    brandSizeparent = document.getElementById('snf5342-widget-size-list')
if(barndSize.length >= 4){
    snfAddClass(brandSizeparent, 'snf5342-widget-has-arrows')
}
var bodyShape = document.querySelectorAll('.snf5342-widget-body-shape-item-inner'),
    bodyShapeparent = document.getElementById('snf5342-widget-body-shape');
    if(bodyShape.length >= 4){
        snfAddClass(bodyShapeparent, 'snf5342-widget-has-arrows')
    }






var currentSlide = 0;
var currentSlide1 = 0;

var owl = jQuery(".11112");
owl.owlCarousel({
    nav:true,
    startPosition: 0,
    items:2,
    touchDrag  : false,
     mouseDrag  : false

})
owl.on('changed.owl.carousel', function(property){
    currentSlide = property.item.index;
    console.log('Image current is ' + currentSlide);
});

owl.on('dragged.owl.carousel', function(property){
    currentSlide = property.item.index;
    console.log('In drag Image current is ' + currentSlide);
    console.log('event : ',property.relatedTarget['_drag']['direction']);
    var direction = property.relatedTarget['_drag']['direction'];
    var e2 = angular.element(document.getElementById('snf5342-widget-fit-list-main'));
    if(direction == 'left'){
        console.log("left");
        e2.scope().try2(2,currentSlide);
    }else if(direction == 'right'){
        console.log("right");
        e2.scope().try2(1,currentSlide);
    }
});



var owl1 = jQuery(".11111");
owl1.owlCarousel({
    nav:true,
    startPosition: 0,
    items:3,
    touchDrag  : false,
     mouseDrag  : false
})

owl1.on('changed.owl.carousel', function(property){
    currentSlide1 = property.item.index;
    console.log('Image current is ' + currentSlide1);
});
owl1.on('dragged.owl.carousel', function(property){
    currentSlide = property.item.index;
    console.log('In drag Image current is ' + currentSlide);
    console.log('event : ',property.relatedTarget['_drag']['direction']);
    var direction = property.relatedTarget['_drag']['direction'];
    var e2 = angular.element(document.getElementById('snf5342-widget-size-list'));
    if(direction == 'left'){
        console.log("left");
        e2.scope().try3(2,currentSlide);
    }else if(direction == 'right'){
        console.log("right");
        e2.scope().try3(1,currentSlide);
    }
});



var siemaFitListprev = document.querySelector('.snf5342-widget-fit-list-prev');
var siemaFitListnext = document.querySelector('.snf5342-widget-fit-list-next');

siemaFitListprev.addEventListener('click', function(){ 
    owl.trigger('prev.owl.carousel');
});
siemaFitListnext.addEventListener('click', function(){ 
    owl.trigger('next.owl.carousel');
});

var siemaSizeListprev = document.querySelector('.snf5342-widget-size-list-prev');
var siemaSizeListnext = document.querySelector('.snf5342-widget-size-list-next');

siemaSizeListprev.addEventListener('click', function(){ 
    owl1.trigger('prev.owl.carousel');
});
siemaSizeListnext.addEventListener('click', function(){
    owl1.trigger('next.owl.carousel');
});

function seimaChangeStyle(index){
    console.log("in seimaChange Style", + (index-1));
        owl.trigger('to.owl.carousel', index-1);
}


function seimaChangeSize(index){
    console.log("in seimaChange size :-", + (index-2));
    owl1.trigger('to.owl.carousel', (index-2));
}


function scrollToptry(id){

     console.log("in scroll try end");
        console.log("Before"+id);
           var elem = jQuery("#"+id);
           var e2 = jQuery("#scroll_1");
           console.log(e2.offset().top);
           console.log(elem.offset().top);
           console.log(Math.abs(elem.offset().top - e2.offset().top));

                    e2.scrollTop(Math.abs(elem.offset().top - e2.offset().top));

        console.log("end");
}  


function disableButton(){
    var TabBtn5 = document.getElementById('snf5342-widget-tab-result-overlay');
     snfRemoveClass(TabBtn5, 'snf5342-widget-btn-primary');
     snfRemoveClass(TabBtn5, 'snf5342-widget-btn-primary-filled');
     snfAddClass(TabBtn5, 'snf5342-widget-toggle-disabled');
}
function enableButton(){
    var TabBtn5 = document.getElementById('snf5342-widget-tab-result-overlay');
    snfRemoveClass(TabBtn5, 'snf5342-widget-toggle-disabled');  
                snfAddClass(TabBtn5, 'snf5342-widget-btn-primary');
                snfAddClass(TabBtn5, 'snf5342-widget-btn-primary-filled');
}

function disableButton1(){
    var TabBtn5 = document.getElementById('snf5342-widget-tab-result-overlay1');
     snfRemoveClass(TabBtn5, 'snf5342-widget-btn-primary');
     snfRemoveClass(TabBtn5, 'snf5342-widget-btn-primary-filled');
     snfAddClass(TabBtn5, 'snf5342-widget-toggle-disabled');
}
function enableButton1(){
    var TabBtn5 = document.getElementById('snf5342-widget-tab-result-overlay1');
    snfRemoveClass(TabBtn5, 'snf5342-widget-toggle-disabled');  
                snfAddClass(TabBtn5, 'snf5342-widget-btn-primary');
                snfAddClass(TabBtn5, 'snf5342-widget-btn-primary-filled');
}
function disableButton11(){
    var TabBtn5 = document.getElementById('snf5342-widget-tab-btn-05');
     snfRemoveClass(TabBtn5, 'snf5342-widget-btn-primary');
     snfRemoveClass(TabBtn5, 'snf5342-widget-btn-primary-filled');
     snfAddClass(TabBtn5, 'snf5342-widget-toggle-disabled');
}
function enableButton11(){
    var TabBtn5 = document.getElementById('snf5342-widget-tab-btn-05');
    snfRemoveClass(TabBtn5, 'snf5342-widget-toggle-disabled');  
                snfAddClass(TabBtn5, 'snf5342-widget-btn-primary');
                snfAddClass(TabBtn5, 'snf5342-widget-btn-primary-filled');
}

// model-------------
document.getElementById('snf5342-widget-wrap').onclick = function(e) {
    var modal = document.getElementById('snf5342-widget-wrap');
    var close = document.getElementById('snf5342-widget-close');
    if(e.target != modal) {
        snfAddClass(this, 'snf5342-widget-wrap-open');
        if((e.target.getAttribute('id') == close.getAttribute('id'))){
                            var e2 = angular.element(document.getElementById('snf5342-widget-wrap'));
                            snfRemoveClass(this, 'snf5342-widget-wrap-open');
                            e2.scope().closePopUp();
            }
    } else {
        var e2 = angular.element(document.getElementById('snf5342-widget-wrap'));
        snfRemoveClass(this, 'snf5342-widget-wrap-open');
        e2.scope().closePopUp();
    }
}

document.getElementById('snf5342-widget-wrap-2A').onclick = function(e) { 
    var modal = document.getElementById('snf5342-widget-wrap-2A');
    var close = document.getElementById('snf5342-widget-close');
    var input = document.getElementById('query');
    var list = document.getElementById('ul');

    if(e.target != modal && e.target != close) {
        snfAddClass(this, 'snf5342-widget-wrap-open');
                if((e.target ==input)){
                     myfun();
                }else if((e.target !=input) || (e.target !=list)){
                        if((e.target.getAttribute('id') == close.getAttribute('id'))){
                            var e2 = angular.element(document.getElementById('snf5342-widget-wrap-2A'));
                            snfRemoveClass(this, 'snf5342-widget-wrap-open');
                            e2.scope().closePopUp();
                        }
                     myfun1();
                }
    } else {
        var e2 = angular.element(document.getElementById('snf5342-widget-wrap-2A'));
        snfRemoveClass(this, 'snf5342-widget-wrap-open');
        e2.scope().closePopUp();
    }
}


document.getElementById('snf5342-widget-wrap-2A1').onclick = function(e) {
    var modal = document.getElementById('snf5342-widget-wrap-2A1');
    var close = document.getElementById('snf5342-widget-close');
    var TabBtn5 = document.getElementById('snf5342-widget-tab-result-overlay');
    var e2 = angular.element(document.getElementById('snf5342-widget-fit-list-main'));
    var ls = document.getElementById("left_style");
    var rs = document.getElementById("right_style");
    var lss = document.getElementById("left_style_size");
    var rss = document.getElementById("right_style_size");
    var bool_val_style = false;
    var bool_val_size = false;
   if(document.getElementById('snf5342-widget-style-01').checked){
         bool_val_style = true;
    }else if(document.getElementById('snf5342-widget-style-02').checked){
         bool_val_style = true;
    }else if(document.getElementById('snf5342-widget-style-03').checked){
         bool_val_style = true;
    }else if(document.getElementById('snf5342-widget-style-04').checked){
         bool_val_style = true;
    }else if(document.getElementById('snf5342-widget-style-05').checked){
         bool_val_style = true;
    }else if(document.getElementById('snf5342-widget-style-06').checked){
         bool_val_style = true;
    }

   
    if(document.getElementById('snf5342-widget-size-01').checked){
         bool_val_size = true;
    }else if(document.getElementById('snf5342-widget-size-02').checked){
         bool_val_size = true;
    }else if(document.getElementById('snf5342-widget-size-03').checked){
         bool_val_size = true;
    }else if(document.getElementById('snf5342-widget-size-04').checked){
         bool_val_size = true;
    }else if(document.getElementById('snf5342-widget-size-05').checked){
         bool_val_size = true;
    }else if(document.getElementById('snf5342-widget-size-06').checked){
         bool_val_size = true;
    }else if(document.getElementById('snf5342-widget-size-07').checked){
         bool_val_size = true;
    }else if(document.getElementById('snf5342-widget-size-08').checked){
         bool_val_size = true;
    }else if(document.getElementById('snf5342-widget-size-09').checked){
         bool_val_size = true;
    }else if(document.getElementById('snf5342-widget-size-10').checked){
         bool_val_size = true;
    }else if(document.getElementById('snf5342-widget-size-11').checked){
         bool_val_size = true;
    }else if(document.getElementById('snf5342-widget-size-12').checked){
         bool_val_size = true;
    }else if(document.getElementById('snf5342-widget-size-13').checked){
         bool_val_size = true;
    }else if(document.getElementById('snf5342-widget-size-14').checked){
         bool_val_size = true;
    }else if(document.getElementById('snf5342-widget-size-15').checked){
         bool_val_size = true;
    }

       //Checking if both style and sizes are selected Else disable button
        if(bool_val_size && bool_val_style)
        {
                snfRemoveClass(TabBtn5, 'snf5342-widget-toggle-disabled');  
                snfAddClass(TabBtn5, 'snf5342-widget-btn-primary');
                snfAddClass(TabBtn5, 'snf5342-widget-btn-primary-filled');
        }else{  //if radio seleted and color is red disabled next button
                snfRemoveClass(TabBtn5, 'snf5342-widget-btn-primary');
                snfRemoveClass(TabBtn5, 'snf5342-widget-btn-primary-filled');
                snfAddClass(TabBtn5, 'snf5342-widget-toggle-disabled');
        }

   if(e.target == rs){
                    e2.scope().try2(2,currentSlide);
    }else if(e.target == ls){
                    e2.scope().try2(1,currentSlide);
    }


    if(e.target == rss){
                    e2.scope().try3(2,currentSlide1);
    }else if(e.target == lss){
                    e2.scope().try3(1,currentSlide1);
    }


    if(e.target != modal) {
        snfAddClass(this, 'snf5342-widget-wrap-open');
        if((e.target.getAttribute('id') == close.getAttribute('id'))){
                            console.log("Close Clicked");
                            var e2 = angular.element(document.getElementById('snf5342-widget-wrap-2A1'));
                            snfRemoveClass(this, 'snf5342-widget-wrap-open');
                            e2.scope().closePopUp();
                            console.log("Closed closePopUp");
            }                
    } else {
        var e2 = angular.element(document.getElementById('snf5342-widget-wrap-2A1'));
        snfRemoveClass(this, 'snf5342-widget-wrap-open');
        e2.scope().closePopUp();
    }
}

document.getElementById('snf5342-widget-wrap-2B').onclick = function(e) {
   var modal = document.getElementById('snf5342-widget-wrap-2B');
   var close = document.getElementById('snf5342-widget-close');
   var check = document.getElementById("snf5342-widget-select-height-in");
   var TabBtn5 = document.getElementById('snf5342-widget-tab-btn-05');
   var bool_val;

   //check if the dress radio any value is selected or not
   if(document.getElementById('snf5342-widget-dress-01').checked){
         bool_val = true;
    }else if(document.getElementById('snf5342-widget-dress-02').checked){
         bool_val = true;
    }else if(document.getElementById('snf5342-widget-dress-03').checked){
         bool_val = true;
    }
   
    if(e.target != modal) {
        snfAddClass(this, 'snf5342-widget-wrap-open');
       
        if(bool_val){
            if(check.style.color != 'red')
            {
                    snfRemoveClass(TabBtn5, 'snf5342-widget-toggle-disabled'); 
                    snfAddClass(TabBtn5, 'snf5342-widget-btn-primary');
                    snfAddClass(TabBtn5, 'snf5342-widget-btn-primary-filled');
            }else{  //if radio seleted and color is red disabled next button
                    snfRemoveClass(TabBtn5, 'snf5342-widget-btn-primary');
                    snfRemoveClass(TabBtn5, 'snf5342-widget-btn-primary-filled');
                    snfAddClass(TabBtn5, 'snf5342-widget-toggle-disabled');
            }
        }

        if((e.target.getAttribute('id') == close.getAttribute('id')))
        {
                            var e2 = angular.element(document.getElementById('snf5342-widget-wrap-2B'));
                            snfRemoveClass(this, 'snf5342-widget-wrap-open');
                            e2.scope().closePopUp();
        }

    }else{//if clicked outside of the widget wrap close the widget
        var e2 = angular.element(document.getElementById('snf5342-widget-wrap-2B'));
        snfRemoveClass(this, 'snf5342-widget-wrap-open');
        e2.scope().closePopUp();
    }
}


document.getElementById('snf5342-widget-wrap-2B1').onclick = function(e) {
    var modal = document.getElementById('snf5342-widget-wrap-2B1');
    var close = document.getElementById('snf5342-widget-close');
    var TabBtn5 = document.getElementById('snf5342-widget-tab-result-overlay1');
    var bool_val;
   // if(document.getElementById('snf5342-widget-body-shape-item-1').checked){
   //       bool_val = true;
   //  }else 
    if(document.getElementById('snf5342-widget-body-shape-item-2').checked){
         bool_val = true;
    }else 
    // if(document.getElementById('snf5342-widget-body-shape-item-3').checked){
    //      bool_val = true;
    // }else 
    if(document.getElementById('snf5342-widget-body-shape-item-4').checked){
         bool_val = true;
    }
    
        if(bool_val)
        {
                snfRemoveClass(TabBtn5, 'snf5342-widget-toggle-disabled');  
                snfAddClass(TabBtn5, 'snf5342-widget-btn-primary');
                snfAddClass(TabBtn5, 'snf5342-widget-btn-primary-filled');
        }else{  //if radio seleted and color is red disabled next button
                snfRemoveClass(TabBtn5, 'snf5342-widget-btn-primary');
                snfRemoveClass(TabBtn5, 'snf5342-widget-btn-primary-filled');
                snfAddClass(TabBtn5, 'snf5342-widget-toggle-disabled');
        }


    if(e.target != modal) {
        snfAddClass(this, 'snf5342-widget-wrap-open');
        if((e.target.getAttribute('id') == close.getAttribute('id'))){
                            var e2 = angular.element(document.getElementById('snf5342-widget-wrap-2B1'));
                            snfRemoveClass(this, 'snf5342-widget-wrap-open');
                            e2.scope().closePopUp();
            }
    } else {
        var e2 = angular.element(document.getElementById('snf5342-widget-wrap-2B1'));
        snfRemoveClass(this, 'snf5342-widget-wrap-open');
        e2.scope().closePopUp();
    }
}

document.getElementById('snf5342-widget-wrap-11').onclick = function(e) {
    var modal = document.getElementById('snf5342-widget-wrap-11');
    var close = document.getElementById('snf5342-widget-close');
    
    if(e.target != modal) {
        snfAddClass(this, 'snf5342-widget-wrap-open');
        if((e.target.getAttribute('id') == close.getAttribute('id'))){
                            var e2 = angular.element(document.getElementById('snf5342-widget-wrap-11'));
                            snfRemoveClass(this, 'snf5342-widget-wrap-open');
                            e2.scope().closePopUp();
            }
    } else {
        var e2 = angular.element(document.getElementById('snf5342-widget-wrap-11'));
        snfRemoveClass(this, 'snf5342-widget-wrap-open');
        e2.scope().closePopUp();
    }
}

document.getElementById('snf5342-widget-wrap-12').onclick = function(e) {
     var modal = document.getElementById('snf5342-widget-wrap-12');
    var close = document.getElementById('snf5342-widget-close');
    if(e.target != modal) {
        snfAddClass(this, 'snf5342-widget-wrap-open');
        if((e.target.getAttribute('id') == close.getAttribute('id'))){
                            var e2 = angular.element(document.getElementById('snf5342-widget-wrap-12'));
                            snfRemoveClass(this, 'snf5342-widget-wrap-open');
                            e2.scope().closePopUp();
            }
    } else {
        var e2 = angular.element(document.getElementById('snf5342-widget-wrap-12'));
        snfRemoveClass(this, 'snf5342-widget-wrap-open');
        e2.scope().closePopUp();
    }
}

document.getElementById('snf5342-widget-wrap-8').onclick = function(e) {
     var modal = document.getElementById('snf5342-widget-wrap-8');
    var close = document.getElementById('snf5342-widget-close');
    if(e.target != modal) {
        snfAddClass(this, 'snf5342-widget-wrap-open');
        if((e.target.getAttribute('id') == close.getAttribute('id'))){
                            var e2 = angular.element(document.getElementById('snf5342-widget-wrap-8'));
                            snfRemoveClass(this, 'snf5342-widget-wrap-open');
                            e2.scope().closePopUp();
            }
    } else {
        var e2 = angular.element(document.getElementById('snf5342-widget-wrap-8'));
        snfRemoveClass(this, 'snf5342-widget-wrap-open');
        e2.scope().closePopUp();
    }
}






/*-----New codes for mobile and IE ---*/
var snfisMobile = { 
Android: function() { return navigator.userAgent.match(/Android/i); }, 
BlackBerry: function() { return navigator.userAgent.match(/BlackBerry/i); }, 
iOS: function() { return navigator.userAgent.match(/iPhone|iPad|iPod/i); }, 
Opera: function() { return navigator.userAgent.match(/Opera Mini/i); }, 
Windows: function() { return navigator.userAgent.match(/IEMobile/i); }, 
any: function() { return (snfisMobile.Android() || snfisMobile.BlackBerry() || snfisMobile.iOS() || snfisMobile.Opera() || snfisMobile.Windows()); } };

if(snfisMobile.Android()){
var BrandProfile = document.getElementById('snf5342-widget-form-control-brnad'),
    BrandProfileScrollDiv = document.getElementById('snf5342-widget-form-control-brnad-fix');   
    BrandProfile.onfocus = function(){
        setTimeout(function(){ 
            BrandProfileScrollDiv.scrollTop = BrandProfile.parentNode.offsetTop;
        }, 500);
    }
    var BrandHW = document.getElementById('snf5342-widget-form-control-hw'),
    BrandHWScrollDiv = document.getElementById('snf5342-widget-form-control-hw-fix');
    BrandHW.onfocus = function(){
        
        setTimeout(function(){ 
            BrandHWScrollDiv.scrollTop = BrandHW.parentNode.offsetTop;
        }, 500);
    }
}
