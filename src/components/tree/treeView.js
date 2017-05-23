/*eslint-env browser*/
/*eslint dot-notation: 0*/
import React from "react";
import ReactDOM from "react-dom";
import d3 from "d3";
import * as globals from "../../util/globals";
import Card from "../framework/card";
import Legend from "./legend";
import ZoomOutIcon from "../framework/zoom-out-icon";
import ZoomInIcon from "../framework/zoom-in-icon";
import PhyloTree from "../../util/phyloTree";
import { ReactSVGPanZoom } from "react-svg-pan-zoom";
import { mediumTransitionDuration } from "../../util/globals";
import InfoPanel from "./infoPanel";
import BranchSelectedPanel from "./branchSelectedPanel";
import TipSelectedPanel from "./tipSelectedPanel";
import { connect } from "react-redux";
import computeResponsive from "../../util/computeResponsive";
import { branchOpacityConstant, branchOpacityFunction } from "../../util/treeHelpers";
import * as funcs from "./treeViewFunctions";

/*
this.props.tree contains the nodes etc used to build the PhyloTree
object "tree". Those nodes are in a 1-1 ordering, and
there are actually backlinks from the phylotree tree
(i.e. tree.nodes[i].n links to props.tree.nodes[i])
*/

@connect((state) => {
  return {
    tree: state.tree,
    metadata: state.metadata.metadata,
    colorOptions: state.metadata.colorOptions,
    browserDimensions: state.browserDimensions.browserDimensions,
    map: state.map,
    colorBy: state.controls.colorBy,
    colorByLikelihood: state.controls.colorByLikelihood,
    layout: state.controls.layout,
    confidence: state.controls.confidence,
    showBranchLabels: state.controls.showBranchLabels,
    distanceMeasure: state.controls.distanceMeasure,
    sequences: state.sequences,
    selectedLegendItem: state.controls.selectedLegendItem,
    colorScale: state.controls.colorScale,
    datasetGuid: state.tree.datasetGuid,
    mutType: state.controls.mutType
  };
})
class TreeView extends React.Component {
  constructor(props) {
    super(props);
    this.Viewer = null;
    this.state = {
      tool: "pan",  //one of `none`, `pan`, `zoom`, `zoom-in`, `zoom-out`
      hover: null,
      selectedBranch: null,
      selectedTip: null,
      tree: null,
      shouldReRender: false // start off this way I guess
    };
  }
  static contextTypes = {
    router: React.PropTypes.object.isRequired
  }
  static propTypes = {
    sidebar: React.PropTypes.bool.isRequired,
    mutType: React.PropTypes.string.isRequired
  }

  componentWillMount() {
    /* the tree resets itself on resize, so reset selections */
    window.addEventListener("resize",
      () => this.setState({
        hover: null,
        selectedBranch: null,
        selectedTip: null
      })
    );
  }

  componentWillReceiveProps(nextProps) {
    /* This both creates the tree (when it's loaded into redux) and
    works out what to update, based upon changes to redux.control */
    let tree = this.state.tree;
    const changes = funcs.salientPropChanges(this.props, nextProps, tree);

    if (changes.dataInFlux) {
      this.setState({tree: null});
      return null;
    } else if (changes.datasetChanged || changes.firstDataReady) {
      tree = this.makeTree(nextProps);
      this.setState({tree, shouldReRender: true});
      if (this.Viewer) {
        this.Viewer.fitToViewer();
      }
      // return null // TODO why do we need to update styles&attrs on the first round?
    } else if (!tree) {
      return null;
    }

    /* the objects storing the changes to make to the tree */
    const tipAttrToUpdate = {};
    const tipStyleToUpdate = {};
    const branchAttrToUpdate = {};
    const branchStyleToUpdate = {};

    if (changes.visibility) {
      tipStyleToUpdate["visibility"] = nextProps.tree.visibility;
    }
    if (changes.tipRadii) {
      tipAttrToUpdate["r"] = nextProps.tree.tipRadii;
    }
    if (changes.colorBy) {
      tipStyleToUpdate["fill"] = nextProps.tree.nodeColors.map((col) => {
        return d3.rgb(col).brighter([0.65]).toString();
      });
      tipStyleToUpdate["stroke"] = nextProps.tree.nodeColors;
      // likelihoods manifest as opacity ramps
      if (nextProps.colorByLikelihood === true) {
        branchStyleToUpdate["stroke"] = nextProps.tree.nodeColors.map((col, idx) => {
          const attr = nextProps.tree.nodes[idx].attr;
          const entropy = attr[nextProps.colorBy + "_entropy"];
          // const lhd = attr[nextProps.colorBy + "_likelihoods"][attr[nextProps.colorBy]];
          return d3.rgb(d3.interpolateRgb(col, "#BBB")(branchOpacityFunction(entropy))).toString();
        });
      } else {
        branchStyleToUpdate["stroke"] = nextProps.tree.nodeColors.map((col) => {
          return d3.rgb(d3.interpolateRgb(col, "#BBB")(branchOpacityConstant)).toString();
        });
      }
    }
    if (changes.branchThickness) {
      branchStyleToUpdate["stroke-width"] = nextProps.tree.branchThickness;
    }

    /* implement style * attr changes */
    if (Object.keys(branchAttrToUpdate).length || Object.keys(branchStyleToUpdate).length) {
      // console.log("applying branch attr", Object.keys(branchAttrToUpdate), "branch style changes", Object.keys(branchStyleToUpdate))
      tree.updateMultipleArray(".branch", branchAttrToUpdate, branchStyleToUpdate, changes.branchTransitionTime);
    }
    if (Object.keys(tipAttrToUpdate).length || Object.keys(tipStyleToUpdate).length) {
      // console.log("applying tip attr", Object.keys(tipAttrToUpdate), "tip style changes", Object.keys(tipStyleToUpdate))
      tree.updateMultipleArray(".tip", tipAttrToUpdate, tipStyleToUpdate, changes.tipTransitionTime);
    }

    if (changes.layout) { /* swap layouts */
      tree.updateLayout(nextProps.layout, mediumTransitionDuration);
    }
    if (changes.distanceMeasure) { /* change distance metrics */
      tree.updateDistance(nextProps.distanceMeasure, mediumTransitionDuration);
    }
    if (changes.branchLabels === 2) {
      tree.showBranchLabels();
    } else if (changes.branchLabels === 1) {
      tree.hideBranchLabels();
    }
  }

  shouldComponentUpdate(nextProps, nextState) {
    /* we are now in a position to control the rendering to improve performance */
    if (nextState.shouldReRender) {
      this.setState({shouldReRender: false});
      return true;
    } else if (
      this.state.tree &&
      (this.props.browserDimensions.width !== nextProps.browserDimensions.width ||
      this.props.browserDimensions.height !== nextProps.browserDimensions.height ||
      this.props.sidebar !== nextProps.sidebar)
    ) {
      return true;
    } else if (
      this.state.hovered !== nextState.hovered ||
      this.state.selectedTip !== nextState.selectedTip ||
      this.state.selectedBranch !== nextState.selectedBranch
    ) {
      return true;
    }
    return false;
  }

  componentDidUpdate(prevProps) {
    /* after a re-render (i.e. perhaps the SVG has changed size) call zoomIntoClade
    so that the tree rescales to fit the SVG
    */
    if (
      // the tree exists AND
      this.state.tree &&
      // it's not the first render (the listener is registered and width/height passed in)  AND
      prevProps.browserDimensions && this.props.browserDimensions &&
      // the browser dimensions have changed
      (prevProps.browserDimensions.width !== this.props.browserDimensions.width ||
      prevProps.browserDimensions.height !== this.props.browserDimensions.height)
    ) {
      this.state.tree.zoomIntoClade(this.state.tree.nodes[0], mediumTransitionDuration);
    } else if (
      // the tree exists AND the sidebar has changed
      this.state.tree && (this.props.sidebar !== prevProps.sidebar)
    ) {
      this.state.tree.zoomIntoClade(this.state.tree.nodes[0], mediumTransitionDuration);
    }
  }

  makeTree(nextProps) {
    const nodes = nextProps.tree.nodes;
    if (nodes && this.refs.d3TreeElement) {
      var myTree = new PhyloTree(nodes[0]);
      // https://facebook.github.io/react/docs/refs-and-the-dom.html
      var treeplot = d3.select(this.refs.d3TreeElement);
      myTree.render(
        treeplot,
        this.props.layout,
        this.props.distanceMeasure,
        {
          /* options */
          grid: true,
          confidence: this.props.confidence,
          branchLabels: true,      //generate DOM object
          showBranchLabels: false,  //hide them initially -> couple to redux state
          tipLabels: true,      //generate DOM object
          showTipLabels: true   //show
        },
        {
          /* callbacks */
          onTipHover: funcs.onTipHover.bind(this),
          onTipClick: funcs.onTipClick.bind(this),
          onBranchHover: funcs.onBranchHover.bind(this),
          onBranchClick: funcs.onBranchClick.bind(this),
          onBranchLeave: funcs.onBranchLeave.bind(this),
          onTipLeave: funcs.onTipLeave.bind(this),
          // onBranchOrTipLeave: this.onBranchOrTipLeave.bind(this),
          branchLabel: funcs.branchLabel,
          branchLabelSize: funcs.branchLabelSize,
          tipLabel: (d) => d.n.strain,
          tipLabelSize: funcs.tipLabelSize.bind(this)
        },
        /* branch Thicknesses - guarenteed to be in redux by now */
        nextProps.tree.branchThickness,
        nextProps.tree.visibility
      );
      return myTree;
    } else {
      return null;
    }
  }

  render() {
    const responsive = computeResponsive({
      horizontal: this.props.browserDimensions && this.props.browserDimensions.width > globals.twoColumnBreakpoint ? .5 : 1,
      vertical: 1.0,
      browserDimensions: this.props.browserDimensions,
      sidebar: this.props.sidebar,
      minHeight: 480,
      maxAspectRatio: 1.0
    })
    const cardTitle = this.state.selectedBranch ? "." : "Phylogeny";

    return (
      <Card center title={cardTitle}>
        <Legend sidebar={this.props.sidebar}/>
        <InfoPanel
          mutType={this.props.mutType}
          tree={this.state.tree}
          hovered={this.state.hovered}
          viewer={this.Viewer}
          colorBy={this.props.colorBy}
          likelihoods={this.props.colorByLikelihood}
        />
        <BranchSelectedPanel
          responsive={responsive}
          viewEntireTreeCallback={() => funcs.viewEntireTree.bind(this)()}
          branch={this.state.selectedBranch}
        />
        <TipSelectedPanel
          goAwayCallback={(d) => funcs.clearSelectedTip.bind(this)(d)}
          tip={this.state.selectedTip}
        />
        <ReactSVGPanZoom
          width={responsive ? responsive.width : 1}
          height={responsive ? responsive.height : 1}
          ref={(Viewer) => {
            // https://facebook.github.io/react/docs/refs-and-the-dom.html
            this.Viewer = Viewer
          }}
          style={{cursor: "default"}}
          tool={'pan'}
          detectWheel={false}
          toolbarPosition={"none"}
          detectAutoPan={false}
          background={"#FFF"}
          // onMouseDown={this.startPan.bind(this)}
          onDoubleClick={funcs.resetView.bind(this)}
          //onMouseUp={this.endPan.bind(this)}
          onChangeValue={ funcs.onViewerChange.bind(this) }
        >
          <svg style={{pointerEvents: "auto"}}
            width={responsive.width}
            height={responsive.height}
          >
            <g
              width={responsive.width}
              height={responsive.height}
              id={"d3TreeElement"}
              style={{cursor: "default"}}
              ref="d3TreeElement"
            >
            </g>
          </svg>
        </ReactSVGPanZoom>
        <svg width={50} height={130}
          style={{position: "absolute", right: 20, bottom: 20}}>
            <defs>
              <filter id="dropshadow" height="130%">
                <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>
                <feOffset dx="2" dy="2" result="offsetblur"/>
                <feComponentTransfer>
                  <feFuncA type="linear" slope="0.2"/>
                </feComponentTransfer>
                <feMerge>
                  <feMergeNode/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>
          <ZoomInIcon
            handleClick={funcs.handleIconClick.bind(this)("zoom-in")}
            active
            x={10}
            y={50}
          />
          <ZoomOutIcon
            handleClick={funcs.handleIconClick.bind(this)("zoom-out")}
            active={true}
            x={10}
            y={90}
          />
        </svg>
      </Card>
    );
  }
}

export default TreeView;
