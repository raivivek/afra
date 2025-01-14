var _gaq = _gaq || []; // global task queue for Google Analytics

define( [
            'dojo/_base/declare',
            'dojo/_base/lang',
            'dojo/on',
            'dojo/keys',
            'dojo/Deferred',
            'dojo/DeferredList',
            'dojo/topic',
            'dojo/aspect',
            'dojo/request',
            'JBrowse/has',
            'dojo/_base/array',
            'underscore',
            'dijit/layout/ContentPane',
            'dijit/layout/BorderContainer',
            'dijit/focus',
            'JBrowse/Util',
            'JBrowse/FeatureFiltererMixin',
            'JBrowse/GenomeView',
            'JBrowse/TouchScreenSupport',
            'JBrowse/ConfigManager',
            'JBrowse/View/InfoDialog',
            'JBrowse/View/FileDialog',
            'JBrowse/Model/Location',
            'JBrowse/View/LocationChoiceDialog',
            'JBrowse/View/Dialog/SetHighlight',
            'JBrowse/View/Track/Sequence',
            'JBrowse/View/Track/EditTrack',
            'JBrowse/FeatureEdgeMatchManager',
            'JBrowse/FeatureSelectionManager',
            'JBrowse/RegexSequenceSearch'
        ],
        function(
            declare,
            lang,
            on,
            keys,
            Deferred,
            DeferredList,
            topic,
            aspect,
            request,
            has,
            array,
            _,
            dijitContentPane,
            dijitBorderContainer,
            dijitFocus,
            Util,
            FeatureFiltererMixin,
            GenomeView,
            Touch,
            ConfigManager,
            InfoDialog,
            FileDialog,
            Location,
            LocationChoiceDialog,
            SetHighlightDialog,
            SequenceTrack,
            EditTrack,
            FeatureEdgeMatchManager,
            FeatureSelectionManager,
            RegexSequenceSearch
        ) {


var dojof = Util.dojof;

/**
 * Construct a new Browser object.
 * @class This class is the main interface between JBrowse and embedders
 * @constructor
 * @param params an object with the following properties:<br>
 * <ul>
 * <li><code>config</code> - list of objects with "url" property that points to a config JSON file</li>
 * <li><code>containerID</code> - ID of the HTML element that contains the browser</li>
 * <li><code>refSeqs</code> - object with "url" property that is the URL to list of reference sequence information items</li>
 * <li><code>browserRoot</code> - (optional) URL prefix for the browser code</li>
 * <li><code>tracks</code> - (optional) comma-delimited string containing initial list of tracks to view</li>
 * <li><code>location</code> - (optional) string describing the initial location</li>
 * <li><code>defaultTracks</code> - (optional) comma-delimited string containing initial list of tracks to view if there are no cookies and no "tracks" parameter</li>
 * <li><code>defaultLocation</code> - (optional) string describing the initial location if there are no cookies and no "location" parameter</li>
 * <li><code>show_overview</code> - (optional) string describing the on/off state of overview</li>
 * </ul>
 */

return declare(FeatureFiltererMixin, {

constructor: function(params) {
    this.globalKeyboardShortcuts = {};
    this.globalKeyboardShortcutsPreventDefault = {};

    this.config = params;

    // if we're in the unit tests, stop here and don't do any more initialization
    if( this.config.unitTestMode )
        return;

    if( ! this.config.baseUrl )
        this.config.baseUrl = Util.resolveUrl( window.location.href, '.' ) + '/data/';

    this.startTime = new Date();

    this.container = dojo.byId( this.config.containerID );
    this.container.onselectstart = function() { return false; };

    // start the initialization process
    var thisB = this;

    // hand the browser object to the feature edge match manager
    FeatureEdgeMatchManager.setBrowser(this);

    this.featSelectionManager  = new FeatureSelectionManager();
    this.annotSelectionManager = new FeatureSelectionManager();

    // set up exclusive selection -- if selection is made in annot track, any
    // selection in other tracks is deselected, and vice versa, regardless of
    // multi-select mode etc.
    this.annotSelectionManager.addMutualExclusion(this.featSelectionManager);
    this.featSelectionManager.addMutualExclusion(this.annotSelectionManager);

    FeatureEdgeMatchManager.addSelectionManager(this.featSelectionManager);
    FeatureEdgeMatchManager.addSelectionManager(this.annotSelectionManager);

    // Intialize regular expression based sequence search widget.
    new RegexSequenceSearch({browser: this});

    dojo.addOnLoad( function() {
        thisB.loadConfig().then( function() {
            // initialize our highlight if one was set in the config
            if( thisB.config.initialHighlight )
                thisB.setHighlight(new Location(thisB.config.initialHighlight));

            thisB.initTrackMetadata();
            thisB.loadRefSeqs().then(function() {
                thisB.initView().then(function() {
                    // init touch device support
                    Touch.loadTouch();

                    // open all tracks defined in config and move to
                    // coordinates if defined
                    thisB.showRegion(thisB.config);

                    thisB.passMilestone('completely initialized', {success: true});
                });
            });
        });
    });
},

version: function() {
    // when a build is put together, the build system assigns a string
    // to the variable below.
    var BUILD_SYSTEM_JBROWSE_VERSION;
    return BUILD_SYSTEM_JBROWSE_VERSION || 'development';
}.call(),

/**
 * Resolve a URL relative to the browserRoot.
 */
resolveUrl: function( url ) {
    var browserRoot = this.config.browserRoot || "";
    if( browserRoot && browserRoot.charAt( browserRoot.length - 1 ) != '/' )
        browserRoot += '/';

    return Util.resolveUrl( browserRoot, url );
},

loadRefSeqs: function () {
    return this._milestoneFunction('loadRefSeqs', function (deferred) {
        var browser = this;
        var resolveRefSeqs = function (refSeqs) {
            browser.addRefSeqs(refSeqs);
            deferred.resolve({success: true});
        };

        // load our ref seqs
        if (typeof this.config.refSeqs == 'string') {
            dojo.xhrGet({
                url: this.config.refSeqs,
                handleAs: 'json',
                load: function (refSeqs) {
                    resolveRefSeqs(refSeqs);
                },
                error: function (e) {
                    console.error('Failed to load reference sequence info: ', e, e.stack);
                    deferred.resolve({success: false, error: e});
                }
            });
        }
        else {
            resolveRefSeqs(this.config.refSeqs);
        }
    });
},

/**
 * Event that fires when the reference sequences have been loaded.
 */
onRefSeqsLoaded: function() {
},

/**
 * Compare two reference sequence names, returning -1, 0, or 1
 * depending on the result.  Case insensitive, insensitive to the
 * presence or absence of prefixes like 'chr', 'chrom', 'ctg',
 * 'contig', 'scaffold', etc
 */
compareReferenceNames: function( a, b ) {
    return this.regularizeReferenceName(a).localeCompare( this.regularizeReferenceName( b ) );
},

regularizeReferenceName: function( refname ) {

    if( this.config.exactReferenceSequenceNames )
        return refname;

    refname = refname.toLowerCase()
                     .replace(/^chro?m?(osome)?/,'chr')
                     .replace(/^co?n?ti?g/,'ctg')
                     .replace(/^scaff?o?l?d?/,'scaffold')
                     .replace(/^([a-z]*)0+/,'$1')
                     .replace(/^(\d+)$/, 'chr$1' );

    return refname;
},

initView: function() {
    var thisObj = this;
    return this._milestoneFunction('initView', function( deferred ) {

        //set up top nav/overview pane and main GenomeView pane
        dojo.addClass( this.container, "jbrowse"); // browser container has an overall .jbrowse class
        dojo.addClass( document.body, this.config.theme || "tundra"); //< tundra dijit theme

        var topPane = dojo.create( 'div',{ style: {overflow: 'hidden'}}, this.container );

        var overview = dojo.create( 'div', { className: 'overview', id: 'overview' }, topPane );
        this.overviewDiv = overview;
        // overview=0 hides the overview, but we still need it to exist
        if( ! this.config.show_overview )
            overview.style.cssText = "display: none";

        this.viewElem = document.createElement("div");
        this.viewElem.className = "dragWindow";
        this.container.appendChild(this.viewElem);

        // HACK
        // https://www.ibm.com/developerworks/community/blogs/hazem/entry/problem_tried_to_register_widget_with_id_xxx_but_that_id_is_already_registered1?lang=en
        var oldWid = dijit.byId(this.config.containerID);
        if (oldWid) {
            oldWid.destroy();
            oldWid = null;
        }
        // -- yebs

        this.containerWidget = new dijitBorderContainer({
            liveSplitters: false,
            design: "sidebar",
            gutters: false
        }, this.container);

        // hook up GenomeView
        this.view = this.viewElem.view =
            new GenomeView(
                { browser: this,
                  elem: this.viewElem,
                  config: this.config.view,
                  stripeWidth: 250,
                  refSeq: this.refSeq,
                  zoomLevel: 1/200
                });

        dojo.connect( this.view, "onFineMove",   this, "onFineMove"   );
        dojo.connect( this.view, "onCoarseMove", this, "onCoarseMove" );

        this.browserWidget =
            new dijitContentPane({region: "center"}, this.viewElem);
        dojo.connect( this.browserWidget, "resize", this,      'onResize' );
        dojo.connect( this.browserWidget, "resize", this.view, 'onResize' );

        //set initial location
        this.afterMilestone( 'loadRefSeqs', dojo.hitch( this, function() {
            this.afterMilestone( 'initTrackMetadata', dojo.hitch( this, function() {
                this.containerWidget.startup();
                this.onResize();
                this.view.onResize();

                // make our global keyboard shortcut handler
                on(document.body, 'keydown', dojo.hitch(this, 'globalKeyHandler'));

                // configure our event routing
                this._initEventRouting();

                // done with initView
                deferred.resolve({ success: true });
            }));
        }));
    });
},

createCombinationTrack: function() {
    if(this._combinationTrackCount === undefined) this._combinationTrackCount = 0;
    var d = new Deferred();
    var storeConf = {
        browser: this,
        refSeq: this.refSeq,
        type: 'JBrowse/Store/SeqFeature/Combination'
    };
    var storeName = this._addStoreConfig(undefined, storeConf);
    storeConf.name = storeName;
    this.getStore(storeName, function(store) {
        d.resolve(true);
    });
    var thisB = this;
    d.promise.then(function(){
        var combTrackConfig = {
            type: 'JBrowse/View/Track/Combination',
            label: "combination_track" + (thisB._combinationTrackCount++),
            key: "Combination Track " + (thisB._combinationTrackCount),
            metadata: {Description: "Drag-and-drop interface that creates a track out of combinations of other tracks."},
            store: storeName
        };
        // send out a message about how the user wants to create the new tracks
        thisB.publish( '/jbrowse/v1/v/tracks/new', [combTrackConfig] );

        // Open the track immediately
        thisB.publish( '/jbrowse/v1/v/tracks/show', [combTrackConfig] );
    });
},

renderDatasetSelect: function( parent ) {
    var dsconfig = this.config.datasets || {};
    var datasetChoices = [];
    for( var id in dsconfig ) {
        datasetChoices.push( dojo.mixin({ id: id }, dsconfig[id] ) );
    }

    new dijitSelectBox(
        {
            name: 'dataset',
            className: 'dataset_select',
            value: this.config.dataset_id,
            options: array.map(
                datasetChoices,
                function( dataset ) {
                    return { label: dataset.name, value: dataset.id };
                }),
            onChange: dojo.hitch(this, function( dsID ) {
                                     var ds = (this.config.datasets||{})[dsID];
                                     if( ds )
                                         window.location = ds.url;
                                     return false;
                                 })
        }).placeAt( parent );
},

/**
 * Track type registry, used by GUI elements that need to offer
 * options regarding selecting track types.  Can register a track
 * type, and get the data structure describing what track types are
 * known.
 */
registerTrackType: function( args ) {

    var types = this.getTrackTypes();
    var typeName   = args.type;
    var defaultFor = args.defaultForStoreTypes || [];
    var humanLabel = args.label;

    // add it to known track types
    types.knownTrackTypes.push( typeName );

    // add its label
    if( args.label )
        types.trackTypeLabels[typeName] = args.label;

    // uniqify knownTrackTypes
    var seen = {};
    types.knownTrackTypes = array.filter( types.knownTrackTypes, function( type ) {
        var s = seen[type];
        seen[type] = true;
        return !s;
    });

    // set it as default for the indicated types, if any
    array.forEach( defaultFor, function( storeName ) {
        types.trackTypeDefaults[storeName] = typeName;
    });

    // store the whole structure in this object
    this._knownTrackTypes = types;
},

getTrackTypes: function() {
    // create the default types if necessary
    if( ! this._knownTrackTypes )
        this._knownTrackTypes = {
            // map of store type -> default track type to use for the store
            trackTypeDefaults: {
                'JBrowse/Store/SeqFeature/BAM'        : 'JBrowse/View/Track/Alignments2',
                'JBrowse/Store/SeqFeature/NCList'     : 'JBrowse/View/Track/CanvasFeatures',
                'JBrowse/Store/SeqFeature/BigWig'     : 'JBrowse/View/Track/Wiggle/XYPlot',
                'JBrowse/Store/Sequence/StaticChunked': 'JBrowse/View/Track/Sequence',
                'JBrowse/Store/SeqFeature/VCFTabix'   : 'JBrowse/View/Track/HTMLVariants',
                'JBrowse/Store/SeqFeature/GFF3'       : 'JBrowse/View/Track/CanvasFeatures'
            },

            knownTrackTypes: [
                'JBrowse/View/Track/Alignments',
                'JBrowse/View/Track/Alignments2',
                'JBrowse/View/Track/FeatureCoverage',
                'JBrowse/View/Track/SNPCoverage',
                'JBrowse/View/Track/HTMLFeatures',
                'JBrowse/View/Track/CanvasFeatures',
                'JBrowse/View/Track/HTMLVariants',
                'JBrowse/View/Track/Wiggle/XYPlot',
                'JBrowse/View/Track/Wiggle/Density',
                'JBrowse/View/Track/Sequence'
            ],

            trackTypeLabels: {
            }
        };

    return this._knownTrackTypes;
},

openFileDialog: function() {
    new FileDialog({ browser: this })
        .show({
            openCallback: dojo.hitch( this, function( results ) {
                var confs = results.trackConfs || [];
                if( confs.length ) {

                    // tuck away each of the store configurations in
                    // our store configuration, and replace them with
                    // their names.
                    array.forEach( confs, function( conf ) {
                        var storeConf = conf.store;
                        if( storeConf && typeof storeConf == 'object' ) {
                            delete conf.store;
                            var name = this._addStoreConfig( storeConf.name, storeConf );
                            conf.store = name;
                        }
                    },this);

                    // send out a message about how the user wants to create the new tracks
                    this.publish( '/jbrowse/v1/v/tracks/new', confs );

                    // if requested, send out another message that the user wants to show them
                    if( results.trackDisposition == 'openImmediately' )
                        this.publish( '/jbrowse/v1/v/tracks/show', confs );
                }
            })
        });
},

addTracks: function( confs ) {
    // just register the track configurations right now
    this._addTrackConfigs( confs );
},
replaceTracks: function( confs ) {
    // just add-or-replace the track configurations
    this._replaceTrackConfigs( confs );
},
deleteTracks: function( confs ) {
    // de-register the track configurations
    this._deleteTrackConfigs( confs );
},

/**
 * Initialize our message routing, subscribing to messages, forwarding
 * them around, and so forth.
 *
 * "v" (view)
 *   Requests from the user.  These go only to the browser, which is
 *   the central point forx deciding what to do about them.  This is
 *   usually just forwarding the command as one or more "c" messages.
 *
 * "c" (command)
 *   Commands from authority, like the Browser object.  These cause
 *   things to actually happen in the UI: things to be shown or
 *   hidden, actions taken, and so forth.
 *
 * "n" (notification)
 *   Notification that something just happened.
 *
 * @private
 */
_initEventRouting: function() {
    var that = this;

    that.subscribe('/jbrowse/v1/v/store/new', function( storeConfigs ) {
        array.forEach( storeConfigs, function( storeConfig ) {
                           storeConfig = lang.mixin( {}, storeConfig );
                           var name = storeConfig.name;
                           delete storeConfig.name;
                           that._addStoreConfig( name, storeConfig );
                       });
    });



    that.subscribe('/jbrowse/v1/v/tracks/hide', function( trackConfigs ) {
        that.publish( '/jbrowse/v1/c/tracks/hide', trackConfigs );
    });
    that.subscribe('/jbrowse/v1/v/tracks/show', function( trackConfigs ) {
        that.addRecentlyUsedTracks( dojo.map(trackConfigs, function(c){ return c.label;}) );
        that.publish( '/jbrowse/v1/c/tracks/show', trackConfigs );
    });

    that.subscribe('/jbrowse/v1/v/tracks/new', function( trackConfigs ) {
        that.addTracks( trackConfigs );
        that.publish( '/jbrowse/v1/c/tracks/new', trackConfigs );
        that.publish( '/jbrowse/v1/n/tracks/new', trackConfigs );
    });
    that.subscribe('/jbrowse/v1/v/tracks/replace', function( trackConfigs ) {
        that.replaceTracks( trackConfigs );
        that.publish( '/jbrowse/v1/c/tracks/replace', trackConfigs );
        that.publish( '/jbrowse/v1/n/tracks/replace', trackConfigs );
    });
    that.subscribe('/jbrowse/v1/v/tracks/delete', function( trackConfigs ) {
        that.deleteTracks( trackConfigs );
        that.publish( '/jbrowse/v1/c/tracks/delete', trackConfigs );
        that.publish( '/jbrowse/v1/n/tracks/delete', trackConfigs );
    });

    that.subscribe('/jbrowse/v1/v/tracks/pin', function( trackNames ) {
        that.publish( '/jbrowse/v1/c/tracks/pin', trackNames );
        that.publish( '/jbrowse/v1/n/tracks/pin', trackNames );
    });

    that.subscribe('/jbrowse/v1/v/tracks/unpin', function( trackNames ) {
        that.publish( '/jbrowse/v1/c/tracks/unpin', trackNames );
        that.publish( '/jbrowse/v1/n/tracks/unpin', trackNames );
    });
},

/**
 * Get a store object from the store registry, loading its code and
 * instantiating it if necessary.
 */
getStore: function( storeName, callback ) {
    if( !callback ) throw 'invalid arguments';

    this.afterMilestone('loadConfig', dojo.hitch(this, function () {
        var storeCache = this._storeCache || {};
        this._storeCache = storeCache;

        var storeRecord = storeCache[ storeName ];
        if( storeRecord ) {
            storeRecord.refCount++;
            callback( storeRecord.store );
            return;
        }

        var conf = this.config.stores[storeName];
        if( ! conf ) {
            console.warn( "store '"+storeName+"' not found" );
            callback( null );
            return;
        }

        var storeClassName = conf.type;
        if( ! storeClassName ) {
            console.warn( "store "+storeName+" has no type defined" );
            callback( null );
            return;
        }

        require( [ storeClassName ], dojo.hitch( this, function( storeClass ) {
                    var storeArgs = {};
                    dojo.mixin( storeArgs, conf );
                    dojo.mixin( storeArgs,
                                {
                                    config: conf,
                                    browser: this,
                                    refSeq: this.refSeq
                                });

                    // It is possible that the downstream code tried to fetch
                    // the same store a second time before we got a chance to
                    // intialize the requested store on first call. In this
                    // case the last call to getStore will override the
                    // storeRecord in storeCache leading to inconsistencies.
                    // So we check again for presence of storeRecord in
                    // storeCache before initializing the store object.
                    var storeRecord = storeCache[storeName];
                    if (storeRecord) {
                        storeRecord.refCount++;
                        callback(storeRecord.store);
                    }
                    else {
                        var store = new storeClass( storeArgs );
                        this._storeCache[ storeName ] = { refCount: 1, store: store };
                        callback( store );
                    }
                    // release the callback because apparently require
                    // doesn't release this function
                    callback = undefined;
                }));
    }));
},

/**
 * Add a store configuration to the browser.  If name is falsy, will
 * autogenerate one.
 * @private
 */
uniqCounter: 0,
_addStoreConfig: function( /**String*/ name, /**Object*/ storeConfig ) {
    name = name || 'addStore'+this.uniqCounter++;

    if( ! this.config.stores )
        this.config.stores = {};
    if( ! this._storeCache )
        this._storeCache = {};

    if( this.config.stores[name] || this._storeCache[name] ) {
        throw "store "+name+" already exists!";
    }

    this.config.stores[name] = storeConfig;
    return name;
},

clearStores: function() {
    this._storeCache = {};
},

/**
 * Notifies the browser that the given named store is no longer being
 * used by the calling component.  Decrements the store's reference
 * count, and if the store's reference count reaches zero, the store
 * object will be discarded, to be recreated again later if needed.
 */
// not actually being used yet
releaseStore: function( storeName ) {
    var storeRecord = this._storeCache[storeName];
    if( storeRecord && ! --storeRecord.refCount )
        delete this._storeCache[storeName];
},

_calculateClientStats: function() {

    var scn = screen || window.screen;

    // make a flat (i.e. non-nested) object for the stats, so that it
    // encodes compactly in the query string
    var date = new Date();
    var stats = {
        ver: this.version || 'dev',
        'refSeqs-count': this.refSeqOrder.length,
        'refSeqs-avgLen':
          ! this.refSeqOrder.length
            ? null
            : dojof.reduce(
                dojo.map( this.refSeqOrder,
                          function(name) {
                              var ref = this.allRefs[name];
                              if( !ref )
                                  return 0;
                              return ref.end - ref.start;
                          },
                          this
                        ),
                '+'
            ),
        'tracks-count': this.config.tracks.length,
        'plugins': dojof.keys( this.plugins ).sort().join(','),

        // screen geometry
        'scn-h': scn ? scn.height : null,
        'scn-w': scn ? scn.width  : null,
        // window geometry
        'win-h':document.body.offsetHeight,
        'win-w': document.body.offsetWidth,
        // container geometry
        'el-h': this.container.offsetHeight,
        'el-w': this.container.offsetWidth,

        // time param to prevent caching
        t: date.getTime()/1000,

        // also get local time zone offset
        tzoffset: date.getTimezoneOffset(),

        loadTime: (date.getTime() - this.startTime)/1000
    };

    // count the number and types of tracks
    dojo.forEach( this.config.tracks, function(trackConfig) {
        var typeKey = 'track-types-'+ trackConfig.type || 'null';
        stats[ typeKey ] =
          ( stats[ typeKey ] || 0 ) + 1;
    });

    return stats;
},

publish: function() {
    if( this.config.logMessages )
        console.log( arguments );

    return topic.publish.apply( topic, arguments );
},
subscribe: function() {
    return topic.subscribe.apply( topic, arguments );
},

onResize: function() {
},

/**
 * Get the list of the most recently used tracks, stored for this user
 * in a cookie.
 * @returns {Array[Object]} as <code>[{ time: (integer), label: (track label)}]</code>
 */
getRecentlyUsedTracks: function() {
    return dojo.fromJson( this.cookie( 'recentTracks' ) || '[]' );
},

/**
 * Add the given list of tracks as being recently used.
 * @param trackLabels {Array[String]} array of track labels to add
 */
addRecentlyUsedTracks: function( trackLabels ) {
    var seen = {};
    var newRecent =
        Util.uniq(
            dojo.map( trackLabels, function(label) {
                          return {
                              label: label,
                              time: Math.round( new Date() / 1000 ) // secs since epoch
                          };
                      },this)
                .concat( dojo.fromJson( this.cookie('recentTracks'))  || [] ),
            function(entry) {
                return entry.label;
            }
        )
        // limit by default to 20 recent tracks
        .slice( 0, this.config.maxRecentTracks || 10 );

    // set the recentTracks cookie, good for one year
    this.cookie( 'recentTracks', newRecent, { expires: 365 } );

    return newRecent;
},

/**
 * Run a function that will eventually resolve the named Deferred
 * (milestone).
 * @param {String} name the name of the Deferred
 */
_milestoneFunction: function( /**String*/ name, func ) {

    var thisB = this;
    var args = Array.prototype.slice.call( arguments, 2 );

    var d = thisB._getDeferred( name );
    args.unshift( d );
    try {
        func.apply( thisB, args ) ;
    } catch(e) {
        console.error( e, e.stack );
        d.resolve({ success:false, error: e });
    }

    return d;
},

/**
 * Fetch or create a named Deferred, which is how milestones are implemented.
 */
_getDeferred: function( name ) {
    if( ! this._deferred )
        this._deferred = {};
    return this._deferred[name] = this._deferred[name] || new Deferred();
},
/**
 * Attach a callback to a milestone.
 */
afterMilestone: function( name, func ) {
    return this._getDeferred(name)
        .then( function() {
                   try {
                       func();
                   } catch( e ) {
                       console.error( ''+e, e.stack, e );
                   }
               });
},
/**
 * Indicate that we've reached a milestone in the initalization
 * process.  Will run all the callbacks associated with that
 * milestone.
 */
passMilestone: function( name, result ) {
    return this._getDeferred(name).resolve( result );
},
/**
 * Return true if we have reached the named milestone, false otherwise.
 */
reachedMilestone: function( name ) {
    return this._getDeferred(name).fired >= 0;
},


/**
 *  Load our configuration file(s) based on the parameters thex
 *  constructor was passed.  Does not return until all files are
 *  loaded and merged in.
 *  @returns nothing meaningful
 */
loadConfig: function () {
    return this._milestoneFunction( 'loadConfig', function( deferred ) {
        var c = new ConfigManager({ config: this.config, defaults: this._configDefaults(), browser: this });
        c.getFinalConfig( dojo.hitch(this, function( finishedConfig ) {
                this.config = finishedConfig;

                // pass the tracks configurations through
                // addTrackConfigs so that it will be indexed and such
                var tracks = finishedConfig.tracks || [];
                delete finishedConfig.tracks;
                this._addTrackConfigs(tracks);

                // coerce some config keys to boolean
                dojo.forEach(['show_overview'], function(v) {
                    this.config[v] = this._coerceBoolean( this.config[v] );
                }, this);

               // set empty tracks array if we have none
               if(! this.config.tracks)
                   this.config.tracks = [];

                deferred.resolve({success:true});
        }));
    });
},

/**
 * Add new track configurations.
 * @private
 */
_addTrackConfigs: function( /**Array*/ configs ) {

    if (!this.config.tracks)
        this.config.tracks = [];
    if (!this.trackConfigsByName)
        this.trackConfigsByName = {};

    configs = _.sortBy(configs, 'order');
    array.forEach(configs, function (conf) {
        this.trackConfigsByName[conf.label] = conf;
        this.config.tracks.push(conf);
    }, this);

    return configs;
},
/**
 * Replace existing track configurations.
 * @private
 */
_replaceTrackConfigs: function( /**Array*/ newConfigs ) {
    if( ! this.trackConfigsByName )
        this.trackConfigsByName = {};

    array.forEach( newConfigs, function( conf ) {
        if( ! this.trackConfigsByName[ conf.label ] ) {
            console.warn("track with label "+conf.label+" does not exist yet.  creating a new one.");
        }

        this.trackConfigsByName[conf.label] =
                           dojo.mixin( this.trackConfigsByName[ conf.label ] || {}, conf );
   },this);
},
/**
 * Delete existing track configs.
 * @private
 */
_deleteTrackConfigs: function( configsToDelete ) {
    // remove from this.config.tracks
    this.config.tracks = array.filter( this.config.tracks || [], function( conf ) {
        return ! array.some( configsToDelete, function( toDelete ) {
            return toDelete.label == conf.label;
        });
    });

    // remove from trackConfigsByName
    array.forEach( configsToDelete, function( toDelete ) {
        if( ! this.trackConfigsByName[ toDelete.label ] ) {
            console.warn( "track "+toDelete.label+" does not exist, cannot delete" );
            return;
        }

        delete this.trackConfigsByName[ toDelete.label ];
    },this);
},

_configDefaults: function() {
    return {
        tracks: [],
        show_overview: true
    };
},

/**
 * Coerce a value of unknown type to a boolean, treating string 'true'
 * and 'false' as the values they indicate, and string numbers as
 * numbers.
 * @private
 */
_coerceBoolean: function(val) {
    if( typeof val == 'string' ) {
        val = val.toLowerCase();
        if( val == 'true' ) {
            return true;
        }
        else if( val == 'false' )
            return false;
        else
            return parseInt(val);
    }
    else if( typeof val == 'boolean' ) {
        return val;
    }
    else if( typeof val == 'number' ) {
        return !!val;
    }
    else {
        return true;
    }
},

/**
 * @param refSeqs {Array} array of refseq records to add to the browser
 */
addRefSeqs: function (refSeqs) {
    var allrefs = this.allRefs = this.allRefs || {};
    dojo.forEach(refSeqs, function (r) {
        this.allRefs[r.name] = r;
    }, this);

    // generate refSeqOrder
    this.refSeqOrder =
        function() {
            var order;
            if( ! this.config.refSeqOrder ) {
                order = refSeqs;
            }
            else {
                order = refSeqs.slice(0);
                order.sort(
                    this.config.refSeqOrder == 'length'            ? function( a, b ) { return a.length - b.length;  }  :
                    this.config.refSeqOrder == 'length descending' ? function( a, b ) { return b.length - a.length;  }  :
                    this.config.refSeqOrder == 'name descending'   ? function( a, b ) { return b.name.localeCompare( a.name ); } :
                                                                     function( a, b ) { return a.name.localeCompare( b.name ); }
                );
            }
            return array.map( order, function( r ) {
                                  return r.name;
                              });
        }.call(this);

    this.refSeq = this.refSeq || this.allRefs[ this.refSeqOrder[0] ];
},


getCurrentRefSeq: function( name, callback ) {
    return this.refSeq || {};
},

getRefSeq: function( name, callback ) {
    if( typeof name != 'string' )
        name = this.refSeqOrder[0];

    callback( this.allRefs[ name ] );
},

/**
 * @private
 */
onFineMove: function(startbp, endbp) {

    if( this.locationTrap ) {
        var length = this.view.ref.end - this.view.ref.start;
        var trapLeft = Math.round((((startbp - this.view.ref.start) / length)
                                   * this.view.overviewBox.w) + this.view.overviewBox.l);
        var trapRight = Math.round((((endbp - this.view.ref.start) / length)
                                    * this.view.overviewBox.w) + this.view.overviewBox.l);
        dojo.style( this.locationTrap, {
                        width: (trapRight - trapLeft) + "px",
                        borderBottomWidth: this.view.locationTrapHeight + "px",
                        borderLeftWidth: trapLeft + "px",
                        borderRightWidth: (this.view.overviewBox.w - trapRight) + "px"
        });
    }
},

/**
 * Asynchronously initialize our track metadata.
 */
initTrackMetadata: function( callback ) {
    return this._milestoneFunction( 'initTrackMetadata', function( deferred ) {
        var metaDataSourceClasses = dojo.map(
                                    (this.config.trackMetadata||{}).sources || [],
                                    function( sourceDef ) {
                                        var url  = sourceDef.url || 'trackMeta.csv';
                                        var type = sourceDef.type || (
                                                /\.csv$/i.test(url)     ? 'csv'  :
                                                /\.js(on)?$/i.test(url) ? 'json' :
                                                'csv'
                                        );
                                        var storeClass = sourceDef['class']
                                            || { csv: 'dojox/data/CsvStore', json: 'dojox/data/JsonRestStore' }[type];
                                        if( !storeClass ) {
                                            console.error( "No store class found for type '"
                                                           +type+"', cannot load track metadata from URL "+url);
                                            return null;
                                        }
                                        return { class_: storeClass, url: url };
                                    });


        require( Array.prototype.concat.apply( ['JBrowse/Store/TrackMetaData'],
                                               dojo.map( metaDataSourceClasses, function(c) { return c.class_; } ) ),
                 dojo.hitch(this,function( MetaDataStore ) {
                     var mdStores = [];
                     for( var i = 1; i<arguments.length; i++ ) {
                         mdStores.push( new (arguments[i])({url: metaDataSourceClasses[i-1].url}) );
                     }

                     this.trackMetaDataStore =  new MetaDataStore(
                         dojo.mixin( dojo.clone(this.config.trackMetadata || {}), {
                                         trackConfigs: this.config.tracks,
                                         browser: this,
                                         metadataStores: mdStores
                                     })
                     );

                     deferred.resolve({success:true});
        }));
    });
},

/**
 * @private
 */

onVisibleTracksChanged: function() {
},

/**
 * Like <code>navigateToLocation()</code>, except it attempts to display the given
 * location with a little bit of flanking sequence to each side, if
 * possible.
 */
showRegion: function (location) {
    var flank = Math.round((location.end - location.start) * 0.5);

    //go to location, with some flanking region
    this.navigateToLocation({
        ref:   location.ref,
        start: location.start - flank,
        end:   location.end   + flank
    });

    // if the location has a track associated with it, show it
    if (location.tracks) {
        this.showTracks(array.map(location.tracks, function (t) {return t && (t.label || t.name) || t;}));
    }
},

/**
 * navigate to a given location
 * @example
 * gb=dojo.byId("GenomeBrowser").genomeBrowser
 * gb.navigateTo("ctgA:100..200")
 * gb.navigateTo("f14")
 * @param loc can be either:<br>
 * &lt;chromosome&gt;:&lt;start&gt; .. &lt;end&gt;<br>
 * &lt;start&gt; .. &lt;end&gt;<br>
 * &lt;center base&gt;<br>
 * &lt;feature name/ID&gt;
 */

navigateTo: function(loc) {
    this.afterMilestone( 'initView', dojo.hitch( this, function() {
        // if it's a foo:123..456 location, go there
        var location = typeof loc == 'string' ? Util.parseLocString( loc ) :  loc;
        if( location ) {
            this.navigateToLocation( location );
        }
        // otherwise, if it's just a word, try to figure out what it is
        else {

            // is it just the name of one of our ref seqs?
            var ref = Util.matchRefSeqName( loc, this.allRefs );
            if( ref ) {
                // see if we have a stored location for this ref seq in a
                // cookie, and go there if we do
                var oldLoc;
                try {
                    oldLoc = Util.parseLocString(
                        dojo.fromJson(
                            this.cookie("location")
                        )[ref.name].l
                    );
                    oldLoc.ref = ref.name; // force the refseq name; older cookies don't have it
                } catch (x) {}
                if( oldLoc ) {
                    this.navigateToLocation( oldLoc );
                    return;
                } else {
                    // if we don't just go to the middle 80% of that refseq,
                    // based on range that can be viewed (start to end)
                    // rather than total length, in case start != 0 || end != length
                    // this.navigateToLocation({ref: ref.name, start: ref.end*0.1, end: ref.end*0.9 });
                    var visibleLength = ref.end - ref.start;
                    this.navigateToLocation({ref:   ref.name,
                                             start: ref.start + (visibleLength * 0.1),
                                             end:   ref.start + (visibleLength * 0.9) } );
                    return;
                }
            }

            // lastly, try to search our feature names for it
            this.searchNames( loc );
        }
    }));
},

// given an object like { ref: 'foo', start: 2, end: 100 }, set the
// browser's view to that location.  any of ref, start, or end may be
// missing, in which case the function will try set the view to
// something that seems intelligent
navigateToLocation: function( location ) {
    this.afterMilestone( 'initView', dojo.hitch( this, function() {
        // validate the ref seq we were passed
        var ref = location.ref ? Util.matchRefSeqName( location.ref, this.allRefs )
                               : this.refSeq;
        if( !ref )
            return;
        location.ref = ref.name;

        // clamp the start and end to the size of the ref seq
        location.start = Math.max( 0, location.start || 0 );
        location.end   = Math.max( location.start,
                                   Math.min( ref.end, location.end || ref.end )
                                 );

        // if it's the same sequence, just go there
        if( location.ref == this.refSeq.name) {
            this.view.setLocation( this.refSeq,
                                   location.start,
                                   location.end
                                 );
            this._updateLocationCookies( location );
        }
        // if different, we need to poke some other things before going there
        else {
            // record names of open tracks and re-open on new refseq
            var curTracks = this.view.visibleTrackNames();

            this.refSeq = this.allRefs[location.ref];
            this.clearStores();

            this.view.setLocation( this.refSeq,
                                   location.start,
                                   location.end );
            this._updateLocationCookies( location );

            //this.showTracks( curTracks );
        }
    }));
},

/**
 * Given a string name, search for matching feature names and set the
 * view location to any that match.
 */
searchNames: function( /**String*/ loc ) {
    var thisB = this;
    this.nameStore.query({ name: loc })
        .then(
            function( nameMatches ) {
                // if we have no matches, pop up a dialog saying so, and
                // do nothing more
                if( ! nameMatches.length ) {
                    new InfoDialog(
                        {
                            title: 'Not found',
                            content: 'Not found: <span class="locString">'+loc+'</span>',
                            className: 'notfound-dialog'
                        }).show();
                    return;
                }

                var goingTo;

                //first check for exact case match
                for (var i = 0; i < nameMatches.length; i++) {
                    if( nameMatches[i].name  == loc )
                        goingTo = nameMatches[i];
                }
                //if no exact case match, try a case-insentitive match
                if( !goingTo ) {
                    for( i = 0; i < nameMatches.length; i++ ) {
                        if( nameMatches[i].name.toLowerCase() == loc.toLowerCase() )
                            goingTo = nameMatches[i];
                    }
                }
                //else just pick a match
                if( !goingTo ) goingTo = nameMatches[0];

                // if it has one location, go to it
                if( goingTo.location ) {

                    //go to location, with some flanking region
                    thisB.showRegionWithHighlight( goingTo.location );
                }
                // otherwise, pop up a dialog with a list of the locations to choose from
                else if( goingTo.multipleLocations ) {
                    new LocationChoiceDialog(
                        {
                            browser: thisB,
                            locationChoices: goingTo.multipleLocations,
                            title: 'Choose '+goingTo.name+' location',
                            prompt: '"'+goingTo.name+'" is found in multiple locations.  Please choose a location to view.'
                        })
                        .show();
                }
            },
            function(e) {
                console.error( e );
                new InfoDialog(
                    {
                        title: 'Error',
                        content: 'Error reading from name store.'
                    }).show();
                return;
            }
   );
},


/**
 * load and display the given tracks
 * @example
 * gb=dojo.byId("GenomeBrowser").genomeBrowser
 * gb.showTracks(["DNA","gene","mRNA","noncodingRNA"])
 * @param trackNameList {Array|String} array or comma-separated string
 * of track names, each of which should correspond to the "label"
 * element of the track information
 */

showTracks: function( trackNames ) {
    this.afterMilestone('initView', dojo.hitch( this, function() {
        if( typeof trackNames == 'string' )
            trackNames = trackNames.split(',');

        if( ! trackNames )
            return;

        var trackConfs = dojo.filter(
            dojo.map( trackNames, function(n) {
                          return this.trackConfigsByName[n];
                      }, this),
            function(c) {return c;} // filter out confs that are missing
        );

        // publish some events with the tracks to instruct the views to show them.
        this.publish( '/jbrowse/v1/c/tracks/show', trackConfs );
        this.publish( '/jbrowse/v1/n/tracks/visibleChanged' );
    }));
},

/**
 * Create a global keyboard shortcut.
 * @param keychar the character of the key that is typed
 * @param [...] additional arguments passed to dojo.hitch for making the handler
 */
setGlobalKeyboardShortcut: function (keychar) {
    // warn if redefining
    if (this.globalKeyboardShortcuts[keychar])
        console.warn("WARNING: JBrowse global keyboard shortcut '"+keychar+"' redefined");

    // make the wrapped handler func
    var func = dojo.hitch.apply(dojo, Array.prototype.slice.call(arguments, 1));

    // remember it
    this.globalKeyboardShortcuts[keychar] = func;
    this.globalKeyboardShortcutsPreventDefault[keychar] = !!arguments[3];
},

/**
 * Key event handler that implements all global keyboard shortcuts.
 */
globalKeyHandler: function( evt ) {
    // if some digit widget is focused, don't process any global keyboard shortcuts
    if (dijitFocus.curNode)
        return;

    var shortcut = this.globalKeyboardShortcuts[evt.keyCode || String.fromCharCode(evt.charCode || evt.keyCode)];
    if (shortcut) {
        evt.stopPropagation();
        if (this.globalKeyboardShortcutsPreventDefault[evt.keyCode]) {
            evt.preventDefault();
        }
        shortcut.call(this);
    }
},

makeShareLink: function () {
    // don't make the link if we were explicitly configured not to
    if( ( 'share_link' in this.config ) && !this.config.share_link )
        return null;

    var browser = this;
    var shareURL = '#';

    // make the share link
    var button = new dijitButton({
            className: 'share',
            innerHTML: '<span class="icon"></span> Share',
            title: 'share this view',
            onClick: function() {
                URLinput.value = shareURL;
                previewLink.href = shareURL;

                sharePane.show();

                var lp = dojo.position( button.domNode );
                dojo.style( sharePane.domNode, {
                               top: (lp.y+lp.h) + 'px',
                               right: 0,
                               left: ''
                            });
                URLinput.focus();
                URLinput.select();
                copyReminder.style.display = 'block';

                return false;
            }
        }
    );

    // make the 'share' popup
    var container = dojo.create(
        'div', {
            innerHTML: 'Paste this link in <b>email</b> or <b>IM</b>'
        });
    var copyReminder = dojo.create('div', {
                                       className: 'copyReminder',
                                       innerHTML: 'Press CTRL-C to copy'
                                   });
    var URLinput = dojo.create(
        'input', {
            type: 'text',
            value: shareURL,
            size: 50,
            readonly: 'readonly',
            onclick: function() { this.select();  copyReminder.style.display = 'block'; },
            onblur: function() { copyReminder.style.display = 'none'; }
        });
    var previewLink = dojo.create('a', {
        innerHTML: 'Preview',
        target: '_blank',
        href: shareURL,
        style: { display: 'block', "float": 'right' }
    }, container );
    var sharePane = new dijitDialog(
        {
            className: 'sharePane',
            title: 'Share this view',
            draggable: false,
            content: [
                container,
                URLinput,
                copyReminder
            ],
            autofocus: false
        });

    return button.domNode;
},

/**
 * Return a string URL that encodes the complete viewing state of the
 * browser.  Currently just data dir, visible tracks, and visible
 * region.
 * @param {Object} overrides optional key-value object containing
 *                           components of the query string to override
 */
makeCurrentViewURL: function( overrides ) {
    var t = typeof this.config.shareURL;

    if( t == 'function' ) {
        return this.config.shareURL.call( this, this );
    }
    else if( t == 'string' ) {
        return this.config.shareURL;
    }

    return "".concat(
        window.location.protocol,
        "//",
        window.location.host,
        window.location.pathname,
        "?",
        dojo.objectToQuery(
            dojo.mixin(
                dojo.mixin( {}, (this.config.queryParams||{}) ),
                dojo.mixin(
                    {
                        loc:    this.view.visibleRegionLocString(),
                        tracks: this.view.visibleTrackNames().join(','),
                        highlight: (this.getHighlight()||'').toString()
                    },
                    overrides || {}
                )
            )
        )
    );
},

/**
 * @private
 */

onCoarseMove: function(startbp, endbp) {

    var currRegion = { start: startbp, end: endbp, ref: this.refSeq.name };

    // update the location box with our current location
    if( this.locationBox ) {
        this.locationBox.set(
            'value',
            Util.assembleLocStringWithLength( currRegion ),
            false //< don't fire any onchange handlers
        );
        this.goButton.set( 'disabled', true ) ;
    }

    // also update the refseq selection dropdown if present
    this._updateRefSeqSelectBox();

    if( this.reachedMilestone('completely initialized') ) {
        this._updateLocationCookies( currRegion );
    }

    // send out a message notifying of the move
    this.publish( '/jbrowse/v1/n/navigate', currRegion );
},

_updateRefSeqSelectBox: function() {
    if( this.refSeqSelectBox ) {

        // if none of the options in the select box match this
        // reference sequence, add another one to the end for it
        if( ! array.some( this.refSeqSelectBox.getOptions(), function( option ) {
                              return option.value == this.refSeq.name;
                        }, this)
          ) {
              this.refSeqSelectBox.set( 'options',
                                     this.refSeqSelectBox.getOptions()
                                     .concat({ label: this.refSeq.name, value: this.refSeq.name })
                                   );
        }

        // set its value to the current ref seq
        this.refSeqSelectBox.set( 'value', this.refSeq.name, false );
    }
},

/**
 * update the location and refseq cookies
 */
_updateLocationCookies: function( location ) {
    var locString = typeof location == 'string' ? location : Util.assembleLocString( location );
    var oldLocMap = dojo.fromJson( this.cookie('location') ) || { "_version": 1 };
    if( ! oldLocMap["_version"] )
        oldLocMap = this._migrateLocMap( oldLocMap );
    oldLocMap[this.refSeq.name] = { l: locString, t: Math.round( (new Date()).getTime() / 1000 ) - 1340211510 };
    oldLocMap = this._limitLocMap( oldLocMap, this.config.maxSavedLocations || 10 );
    this.cookie( 'location', dojo.toJson(oldLocMap), {expires: 60});
},

/**
 * Migrate an old location map cookie to the new format that includes timestamps.
 * @private
 */
_migrateLocMap: function( locMap ) {
    var newLoc = { "_version": 1 };
    for( var loc in locMap ) {
        newLoc[loc] = { l: locMap[loc], t: 0 };
    }
    return newLoc;
},

/**
 * Limit the size of the saved location map, removing the least recently used.
 * @private
 */
_limitLocMap: function( locMap, maxEntries ) {
    // don't do anything if the loc map has fewer than the max
    var locRefs = dojof.keys( locMap );
    if( locRefs.length <= maxEntries )
        return locMap;

    // otherwise, calculate the least recently used that we need to
    // get rid of to be under the size limit
    locMap = dojo.clone( locMap );
    var deleteLocs =
        locRefs
        .sort( function(a,b){
                   return locMap[b].t - locMap[a].t;
               })
        .slice( maxEntries-1 );

    // and delete them from the locmap
    dojo.forEach( deleteLocs, function(locRef) {
        delete locMap[locRef];
    });

    return locMap;
},

/**
 * Wrapper for dojo.cookie that namespaces our cookie names by
 * prefixing them with this.config.containerID.
 *
 * Has one additional bit of smarts: if an object or array is passed
 * instead of a string to set as the cookie contents, will serialize
 * it with dojo.toJson before storing.
 *
 * @param [...] same as dojo.cookie
 * @returns the new value of the cookie, same as dojo.cookie
 */
cookie: function() {
    arguments[0] = this.config.containerID + '-' + arguments[0];
    if( typeof arguments[1] == 'object' )
        arguments[1] = dojo.toJson( arguments[1] );

    var sizeLimit= this.config.cookieSizeLimit || 1200;
    if( arguments[1] && arguments[1].length > sizeLimit ) {
        console.warn("not setting cookie '"+arguments[0]+"', value too big ("+arguments[1].length+" > "+sizeLimit+")");
        return dojo.cookie( arguments[0] );
    }

    return dojo.cookie.apply( dojo.cookie, arguments );
},

/**
 * @private
 */

/**
 * Return the current highlight region, or null if none.
 */
getHighlight: function() {
    return this._highlight || null;
},

/**
 * Set a new highlight.  Returns the new highlight.
 */
setHighlight: function( newHighlight ) {

    if( newHighlight && ( newHighlight instanceof Location ) )
        this._highlight = newHighlight;
    else if( newHighlight )
        this._highlight = new Location( newHighlight );

    this.publish( '/jbrowse/v1/n/globalHighlightChanged', [this._highlight] );

    return this.getHighlight();
},


_updateHighlightClearButton: function() {
    if( this._highlightClearButton ) {
        this._highlightClearButton.set( 'disabled', !!! this._highlight );
        //this._highlightClearButton.set( 'label', 'Clear highlight' + ( this._highlight ? ' - ' + this._highlight : '' ));
    }
},


clearHighlight: function() {
    if( this._highlight ) {
        delete this._highlight;
        this.publish( '/jbrowse/v1/n/globalHighlightChanged', [] );
    }
},

setHighlightAndRedraw: function( location ) {
    var oldHighlight = this.getHighlight();
    if( oldHighlight )
        this.view.hideRegion( oldHighlight );
    this.view.hideRegion( location );
    this.setHighlight( location );
    this.view.showVisibleBlocks( false );
},

/**
 * Clears the old highlight if necessary, sets the given new
 * highlight, and updates the display to show the highlighted location.
 */
showRegionWithHighlight: function( location ) {
    var oldHighlight = this.getHighlight();
    if( oldHighlight )
        this.view.hideRegion( oldHighlight );
    this.view.hideRegion( location );
    this.setHighlight( location );
    this.showRegion( location );
},

/**
 * Get edit track.
 */
getEditTrack: function()  {
    if (this._editTrack) return this._editTrack;
    if (this && this.view && this.view.tracks)  {
        var tracks = this.view.tracks;
        for (var i = 0; i < tracks.length; i++)  {
            if (tracks[i] instanceof EditTrack)  {
                return (this._editTrack = tracks[i]);
            }
        }
    }
    return null;
},

/**
 * Get sequence track.
 */
getSequenceTrack: function()  {
    if (this._sequenceTrack) return this._sequenceTrack;
    if (this && this.view && this.view.tracks)  {
        var tracks = this.view.tracks;
        for (var i = 0; i < tracks.length; i++)  {
            if (tracks[i] instanceof SequenceTrack)  {
                return (this._sequenceTrack = tracks[i]);
            }
        }
    }
    return null;
}

});
});


/*

Copyright (c) 2007-2009 The Evolutionary Software Foundation

Created by Mitchell Skinner <mitch_skinner@berkeley.edu>

This package and its accompanying libraries are free software; you can
redistribute it and/or modify it under the terms of the LGPL (either
version 2.1, or at your option, any later version) or the Artistic
License 2.0.  Refer to LICENSE for the full license text.

*/
