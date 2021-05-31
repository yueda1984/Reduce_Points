// This script requires fit-curve.js, a MLT licensed library (https://github.com/soswow/fit-curves).
var fitCurveJS = require("./lib/fit-curve/fit-curve.js");
var scriptVer = 0.01;

function PROTO_Reduce_Points()
{		
	var PF = new private_functions;		
	var sNodes = selection.selectedNodes();
	sNodes = sNodes.filter(function(item){return node.type(item) === "READ";});
	if( sNodes.length === 0 )
		return;
	
	var maxError = Input.getNumber( "Bigger the value, the smoother the result:", 10, 0, 0, 100, "Reduce Points: Strength" );
	if( maxError === undefined )
		return;
	
	var percentage = 0;
	var max = 100;
	var unit = max/sNodes.length;	
	var pbWindow = PF.defineProgressBar(percentage, max, scriptVer);	
	pbWindow.show();
	PF.updateProgressBar(pbWindow, percentage, "", "");	

	scene.beginUndoRedoAccum("");

	for (var sn = 0; sn < sNodes.length; sn++)
	{
		var useTiming = node.getAttr(sNodes[sn], 1, "drawing.elementMode").boolValue();
		var drawColumn = node.linkedColumn(sNodes[sn], useTiming ? "drawing.element" : "drawing.customName.timing");
		
		// Count numbers of unique cels exposed in the timeline for the progress bar
		var exposedCels = [];
		for (var fm = 1; fm <= frame.numberOf(); fm++)
		{
			var curCel_1 = column.getEntry(drawColumn, 1, fm);			
			if (curCel_1 !== "" && exposedCels.indexOf(curCel_1) === -1)
				exposedCels.push(curCel_1);
		}
		if (exposedCels.length === 0)
		{
			percentage += unit;		
			continue;
		}		
		var subUnit = unit/exposedCels.length;

		// Reduce points on all shapes on the current cel.	
		var parsedCelHistory = [];				
		for (var fr = 1; fr <= frame.numberOf(); fr++)
		{
			var curCel = column.getEntry(drawColumn, 1, fr);
			if (curCel === "" || parsedCelHistory.indexOf(curCel) !== -1)			
				continue;				
		
			parsedCelHistory.push(curCel);
			PF.updateProgressBar(pbWindow, percentage, sNodes[sn], fr);
			PF.parseCel(sNodes[sn], curCel, fr, maxError);
			percentage += subUnit;
			PF.updateProgressBar(pbWindow, percentage, sNodes[sn], fr);			
		}
	}
	
	scene.endUndoRedoAccum("");	
	
	pbWindow.close();
}






//------------------------------------------------------ Helper Functions ------------------------------------------------------>


function private_functions()
{
	this.defineProgressBar = function(initialVal, max, _scriptVer)
	{
		var dialog = new QWidget(this.getParentWidget());
		dialog.setAttribute(Qt.WA_DeleteOnClose);
		dialog.setWindowTitle("Reduce Points v"  + _scriptVer);
		dialog.setMinimumSize(348, 72);
		dialog.setWindowFlags(Qt.Tool);		
		dialog.mainLayout = new QVBoxLayout(dialog);
		dialog.pbLabel = new QLabel("");
		dialog.frameLabel = new QLabel("");		
		dialog.pb = new QProgressBar();
		dialog.pb.setRange(initialVal, max);
		dialog.mainLayout.addWidget(dialog.pbLabel, 0, 0);
		dialog.mainLayout.addWidget(dialog.frameLabel, 0, 1);		
		dialog.mainLayout.addWidget(dialog.pb, 0, 2);				
		return dialog;
	};


	this.getParentWidget = function()
	{
		var topWidgets = QApplication.topLevelWidgets();
		for( var i in topWidgets )
			if( topWidgets[i] instanceof QMainWindow && !topWidgets[i].parentWidget() )
				return topWidgets[i];
		return "";
	};


	this.updateProgressBar = function(pbWindow, percentage, message, fr)
	{
		pbWindow.pbLabel.text = "Node: " + message;
		pbWindow.frameLabel.text = "Frame: " + fr;
		pbWindow.pb.setValue(percentage);
		System.processOneEvent();
		if (!pbWindow.visible)
			pbWindow.close();
	};
	
	
	this.parseCel = function(argNode, fr, maxError)
	{
		for (var at = 0; at < 4; at++)
		{
			var nodeDef = {node: argNode, frame: fr};
			var layerDef = {drawing: nodeDef, art: at};
			var numStrokes = Drawing.query.getNumberOfLayers(layerDef);
			if (numStrokes == 0)
				continue;
			
			var subLayers = Drawing.query.getStrokes(layerDef);
			
			// Clear the current layer first
			var layerIndices = [];
			for (var ly = 0; ly < subLayers.layers.length; ly++)
				layerIndices.push(ly);	
			DrawingTools.deleteLayers({drawing: nodeDef, art: at, layers: layerIndices});
			
			for (var sl = 0; sl < subLayers.layers.length; sl++)
			{				
				// Caprure shapes that use each item on "shaders" array.		
				for (var shaderIdx = 0; shaderIdx < subLayers.layers[sl].shaders.length; shaderIdx++)
				{
					var sublayer = subLayers.layers[sl];
//MessageLog.trace(JSON.stringify(sublayer));
					// Create a history of visited "links" to strokes on joints so we won't parse the same item twice.
					// This will be passed to traceStrokesUntilClose() by reference.
					// Each link is a string: joints index + "-" + strokes index.
					var strokeLink = {}; strokeLink.history = [];						
					var localShapes = [], sequenceHistory = [];					
					for (var jt = 0; jt < sublayer.joints.length; jt++)
					{
						// if the joint doesn't connect shapes together, skip.
						if (sublayer.joints[jt].strokes.length < 2)
						{
							strokeLink.history.push(jt + "-0");						
							continue;
						}
						
						var jointStrokes = sublayer.joints[jt].strokes;	
						for (var js = 0; js < jointStrokes.length; js++)
						{
							var curStrokeLink = jt + "-" + js;
							if (strokeLink.history.indexOf(curStrokeLink) !== -1)							
								continue;
							
							strokeLink.history.push(curStrokeLink);

							var memberStrokes = {};
							memberStrokes.idx = [], memberStrokes.isBackward = [];							
	
							// Find and capture all closed paths. Unfortunately, not all closed paths are marked as closed.
							// We can only tell by checking if the start joint of a chain of paths is same as the last joint.
							// Following fuction travels between paths by tracking stroke indexes found on each joint object.
							// Also find which side of line has the current shader, then keep tracking the path that has the shader on the same side.						
							var stIdx = jointStrokes[js].strokeIndex;
							var shaderSide = null;
							if ("shaderRight" in sublayer.strokes[stIdx] && sublayer.strokes[stIdx].shaderRight === shaderIdx)
								shaderSide = "shaderRight";
							else if ("shaderLeft" in sublayer.strokes[stIdx] && sublayer.strokes[stIdx].shaderLeft === shaderIdx)
								shaderSide = "shaderLeft";
							if (shaderSide === null || sublayer.strokes[stIdx].shaderRight === sublayer.strokes[stIdx].shaderLeft)
								continue;

							// Also check if the first stroke is a backward stroke.
							// This determine whether we should switch shader sides on backward strokes, or regular strokes.
							var isShaderBackward = (jointStrokes[js].vertex !== 0);

							if ( sublayer.strokes[stIdx].closed )
								var closedMemberStrokes = {"idx":[stIdx],"isBackward":[isShaderBackward]};
							else
								var closedMemberStrokes = this.traceStrokesUntilClose(	jointStrokes[js].strokeIndex,
																						jointStrokes[js].vertex,
																						sublayer.joints[jt].x,
																						sublayer.joints[jt].y,
																						sublayer,
																						memberStrokes,
																						strokeLink,
																						shaderIdx,
																						shaderSide,
																						isShaderBackward
								);								
							if (closedMemberStrokes !== null)
							{
								var strokeSequence = closedMemberStrokes.idx.slice();
								var sequenceJoined = strokeSequence.sort().join("-");						
								if (sequenceHistory.indexOf(sequenceJoined) === -1)
								{
									sequenceHistory.push(sequenceJoined);

									// Capture paths by following the stroke indexes captured by closedMemberStrokes
									var shape = [];										
									for (var st = 0; st < closedMemberStrokes.idx.length; st++)
									{
										var curStrokes = subLayers.layers[sl].strokes[closedMemberStrokes.idx[st]];
										
										// Some path's points will come out in reversed order. They need to be parsed from bottom to top.
										if (closedMemberStrokes.isBackward[st])
										{	
											for (var pt = curStrokes.path.length -1; pt >= 1;)
											{						
												var capturedPath = this.capturePath(curStrokes.path, pt, closedMemberStrokes.isBackward[st]);
												shape.push.apply(shape, capturedPath.paths);
												pt -= capturedPath.step;
											}
										}
										else
										{
											for (var pt = 0; pt < curStrokes.path.length -1;)
											{						
												var capturedPath = this.capturePath(curStrokes.path, pt, closedMemberStrokes.isBackward[st]);
												shape.push.apply(shape, capturedPath.paths);
												pt += capturedPath.step;
											}
										}
									}
									localShapes.push(shape);
								}
							}
						}
					}
					// Check if shape(s) found in a layer is hole(s) of another shape within the layer
					var sortedShapes = (localShapes.length > 1)?
						this.findHoles(localShapes):
						sortedShapes = {"0": {owner: localShapes[0]}};

					var curColorId = subLayers.layers[sl].shaders[shaderIdx].colorId;
					for (var ss in sortedShapes)
					{	
						var owner = this.reduceAndRearrange(sortedShapes[ss].owner, maxError);
						var holes = null;						
						if("holes" in sortedShapes[ss])
						{
							holes = [];
							for (var hl = 0; hl < sortedShapes[ss].holes.length; hl++)									
								holes.push(this.reduceAndRearrange(sortedShapes[ss].holes[hl], maxError));	
						}
						this.createShapes( argNode, holes, owner, fr, curColorId, null, null );
					}
				}
			}
		}
	};
	
	
	this.reduceAndRearrange = function(curPath, maxError)
	{
		var points = [];
		var pathLength = curPath.length;	
		if (pathLength >= 250)
			for (var st = 0; st < pathLength-3; st+=4)
			{
				points.push([curPath[st].x, curPath[st].y]);
				if (st === curPath.length-4)
					points.push([curPath[st+3].x, curPath[st+3].y]);				
			}
		// If the bezier doesn't have enough points for line fitting, descretize curPath 4 points at time then convert into arrays of points.			
		else
		{
			var precision = 10 -Math.floor(pathLength/25);		
			for (var st = 0; st < pathLength-3; st+=4)
			{					
				var def = {precision: precision, path: curPath.slice(st, st+4)};
				var discretizedPath = Drawing.geometry.discretize(def);
				discretizedPath.forEach(function(item){points.push([item.x, item.y])});
			}
		}

		// Line fitting using fit-curve.js
		var FT = new fitCurveJS.fitCurveMaster;
		var fittedBezier = FT.fitCurve(points, maxError);					

		// Format the paths to match the convention DrawingTools.createLayers() accepts.
		var reducedPath = [];
		for (var fb = 0; fb < fittedBezier.length; fb++)
		{
			reducedPath.push({x: fittedBezier[fb][0][0], y: fittedBezier[fb][0][1], onCurve: true});
			reducedPath.push({x: fittedBezier[fb][1][0], y: fittedBezier[fb][1][1], onCurve: false});
			reducedPath.push({x: fittedBezier[fb][2][0], y: fittedBezier[fb][2][1], onCurve: false});
			
			if (fb === fittedBezier.length -1)
				reducedPath.push({x: fittedBezier[fb][3][0], y: fittedBezier[fb][3][1], onCurve: true});
		}
		return reducedPath;
	};
	
	
	this.createShapes = function (argNode, holes, owner, fr, colorId, strokeColorId, strokeWidth)
	{		
		var arg = {}
		arg.drawing = {node: argNode, frame: fr};
		arg.art = 1;

		if(holes !== null)
		{		
			arg.masks = [];		
			for (var hl = 0; hl < holes.length; hl++)
				arg.masks.push({path: holes[hl]});
		}
	
		arg.layers = [{
						shaders: [{colorId : colorId}],
						under: true,
						referenceLayer: 0,
						strokes:
						[{
							shaderLeft: 0,
							path: owner
						}]
					}];
		// If shpe has visible outlines
		if (strokeColorId !== null)
		{
			arg.layers[0].strokes[0].stroke = true;
			arg.layers[0].strokes[0].thickness = {maxThickness: strokeWidth*2, minThickness: 0, thicknessPath: strokeWidth*2};
			arg.layers[0].strokes[0].pencilColorId = strokeColorId;			
		}	
		DrawingTools.createLayers(arg);
	};	

					
	this.capturePath = function(paths, idx, isBackward)
	{
		var p0x = paths[idx].x;
		var p0y = paths[idx].y;
		var p0 = {x: p0x, y: p0y, onCurve: true};

		// Check if next points have "onCurve" key. This indicate that the next point is vertices(v).
		// If next key is on curve, the current path is a degenerate bezier. (p0 === p2)(p1 === p3)	
		var isStraight = isBackward ? ("onCurve" in paths[idx-1]) : ("onCurve" in paths[idx+1]); 
		if (isStraight)
		{
			var p2 = {x: p0x, y: p0y, onCurve: false};			
			if (isBackward)
			{			
				var p1x = paths[idx-1].x;	
				var p1y = paths[idx-1].y;
			}
			else
			{			
				var p1x = paths[idx+1].x;	
				var p1y = paths[idx+1].y;
			}
			var p3 = {x:  p1x, y: p1y, onCurve: false};
			var step = 1;				
		// Else, current path is a standard cubic bezier curve			
		}
		else
		{	
			if (isBackward)
			{
				var p2x = paths[idx-1].x;
				var p2y = paths[idx-1].y;
				var p3x = paths[idx-2].x;
				var p3y = paths[idx-2].y;
				var p1x = paths[idx-3].x;
				var p1y = paths[idx-3].y;				
			}
			else
			{
				var p2x = paths[idx+1].x;
				var p2y = paths[idx+1].y;						
				var p3x = paths[idx+2].x;
				var p3y = paths[idx+2].y;
				var p1x = paths[idx+3].x;
				var p1y = paths[idx+3].y;	
			}	
			var p2 = {x: p2x, y: p2y, onCurve: false};
			var p3 = {x: p3x, y: p3y, onCurve: false};
			var step = 3;			
		}
		var p1 = {x: p1x, y: p1y, onCurve: true};

		return {paths: [p0, p2, p3, p1], step: step};
	};

		
	this.traceStrokesUntilClose = function(stIdx, p0Idx, firstJntX, firstJntY, sublayer, memberStrokes, strokeLink, shaderIdx, shaderSide, isShaderBackward)
	{	
		var curStroke = sublayer.strokes[stIdx];
		var isBackward = (p0Idx !== 0);
		var curShaderSide = shaderSide;
		if ((!isBackward && isShaderBackward) || (isBackward && !isShaderBackward))
			curShaderSide = (shaderSide === "shaderRight") ? "shaderLeft" : "shaderRight";
		
		//Skip shapes that does not have the current shader on the same side.
		//Alsp skip invisible strokse, which have no shader on left and right or have the same shader on the both sides.
		if (!(curShaderSide in curStroke) || curStroke[curShaderSide] !== shaderIdx ||
			("shaderRight" in curStroke && "shaderLeft" in curStroke && curStroke.shaderRight === curStroke.shaderLeft)
		)
			return null;

		var p1Idx = isBackward ? 0 : curStroke.path.length -1;						
		var p1X = curStroke.path[p1Idx].x;
		var p1Y = curStroke.path[p1Idx].y;
		
		memberStrokes.idx.push(stIdx);
		memberStrokes.isBackward.push(isBackward);		
		
		if (p1X == firstJntX && p1Y == firstJntY)
			return memberStrokes;

		var nextJointIdx = isBackward ? curStroke.fromJoint : curStroke.toJoint;													
		var nextJointStrokes = sublayer.joints[nextJointIdx].strokes;
		for (var st = 0; st < nextJointStrokes.length; st++)
		{
			var curStrokeLink = nextJointIdx + "-" + st;
			var nextStrokeIdx = nextJointStrokes[st].strokeIndex;
			if (strokeLink.history.indexOf(curStrokeLink) !== -1 || memberStrokes.idx.indexOf(nextStrokeIdx) !== -1)
				continue;
			else
			{				
				strokeLink.history.push(curStrokeLink);								
				var subMemberStrokes = JSON.parse(JSON.stringify(memberStrokes));	
				var subStrokeLink = JSON.parse(JSON.stringify(strokeLink));		
				var returnedMemberStrokes = this.traceStrokesUntilClose(	nextStrokeIdx,
																			nextJointStrokes[st].vertex,
																			firstJntX,
																			firstJntY,
																			sublayer,
																			subMemberStrokes,
																			subStrokeLink,
																			shaderIdx,
																			shaderSide,
																			isShaderBackward
				);
				if (returnedMemberStrokes !== null)
				{
					strokeLink = subStrokeLink;
					return returnedMemberStrokes;
				}
			}
		}

		return null;
	};
	
	
	this.findHoles = function(curShapes)
	{
		var setIdHistory = [], noHoleShapes = [], sortedShapes = {};
		for (var count = 0; count < 10; count++)
		{
			var shapeDef = this.compairTwoShapes(curShapes, setIdHistory);
			if (shapeDef.parentIds.length > 0 || shapeDef.childIds.length > 0 || shapeDef.singleIds.length > 0)
			{
				for (var sg = 0; sg < shapeDef.singleIds.length; sg++)
					if (setIdHistory.indexOf(shapeDef.singleIds[sg]) === -1)
					{
						noHoleShapes.push(curShapes[shapeDef.singleIds[sg]]);
						setIdHistory.push(shapeDef.singleIds[sg]);
					}
				
				for (var pr = shapeDef.parentIds.length -1; pr >= 0; pr--)
				{
					var curParentId = shapeDef.parentIds[pr];
					// If current parent is not a child of another parent, set the current parent as a hole owner
					if (shapeDef.childIds.indexOf(curParentId) === -1 && curParentId !== "deleted")
					{
						sortedShapes[curParentId] = {};
						sortedShapes[curParentId].owner = curShapes[curParentId];
						sortedShapes[curParentId].holes = [];
						setIdHistory.push(curParentId);
						
						for (var ch = shapeDef.childIdsOf[curParentId].length -1; ch >= 0; ch--)
						{
							var curChildId = shapeDef.childIdsOf[curParentId][ch];
							if (curChildId !== "deleted")
							{									
								// Update curChild's parent list
								if (shapeDef.parentIdsOf[curChildId].length > 1)								
									for (var pts = shapeDef.parentIdsOf[curChildId].length -1; pts >= 0; pts--)
										if (shapeDef.parentIds.indexOf(shapeDef.parentIdsOf[curChildId][pts]) === -1)
											shapeDef.parentIdsOf[curChildId].splice(pts, 1);
								
								// Check if current child has only one parent and that matches current parent id
								// If it has multiple parents, skip since it is not a direct child						
								if (shapeDef.parentIdsOf[curChildId].length === 1 && shapeDef.parentIdsOf[curChildId][0] === curParentId)
								{
									sortedShapes[curParentId].holes.push(curShapes[curChildId]);								
									setIdHistory.push(curChildId);
									
									// If current child is a parent of grand children, delete them from shapeDef.childIds
									var mskIdx = shapeDef.parentIds.indexOf(curChildId);
									if (mskIdx !== -1)
									{
										for (var subCh = shapeDef.childIdsOf[curChildId].length -1; subCh >= 0; subCh--)
										{
											var mskIdx2 = shapeDef.childIds.indexOf(shapeDef.childIdsOf[curChildId][subCh]);										
											shapeDef.childIds.splice(mskIdx2, 1);
										}
										// Update curParent's child list
										for (var cls = 0; cls < shapeDef.childIdsOf[curParentId].length; cls++)
											if (shapeDef.childIds.indexOf(shapeDef.childIdsOf[curParentId][cls]) === -1)
												shapeDef.childIdsOf[curParentId].splice(cls, 1, "deleted");										
										
										// Also delete the child from shapeDef.parentIds
										shapeDef.parentIds.splice(mskIdx, 1, "deleted");
									}
								}
							}
						}
					}
					else
						shapeDef.parentIds.splice(curParentId, 1);
				}
			// If finished comparing all items. Wrap up.
			}
			else
			{
				for (var cs = 0; cs < curShapes.length; cs++)
					if (setIdHistory.indexOf(cs) === -1)
						noHoleShapes.push(curShapes[cs]);
				break;	
			}
			
			// merge noHoleShapes into sortedShapes
			var lastParentId = 0;
			for (var ss in sortedShapes)
				lastParentId = Math.max(parseInt[ss], lastParentId);

			for (var nh = 0; nh < noHoleShapes.length; nh++)
			{
				sortedShapes[lastParentId+1] = {};
				sortedShapes[lastParentId+1].owner = noHoleShapes[nh];
				lastParentId++;
			}
		}
		return sortedShapes;
	};

	
	this.compairTwoShapes = function(curShapes, setIdHistory)
	{
		var curShapes2 = curShapes.slice();
		var shapeDef = {};
		shapeDef.parentIds = [], shapeDef.childIds = [], shapeDef.singleIds = [],
		shapeDef.childIdsOf = {}, shapeDef.parentIdsOf = {};
		
		var definedIdHistory = [];		
		for (var shpIdx = 0; shpIdx < curShapes.length -1; shpIdx++)
		{
			function storeDefinition(parId, chldIdx)
			{										
				if (!(parId in shapeDef.childIdsOf))
					shapeDef.childIdsOf[parId] = [chldIdx];
				else
					shapeDef.childIdsOf[parId].push(chldIdx);
				
				if (!(chldIdx in shapeDef.parentIdsOf))
					shapeDef.parentIdsOf[chldIdx] = [parId];
				else
					shapeDef.parentIdsOf[chldIdx].push(parId);

				if (shapeDef.parentIds.indexOf(parId) == -1)																				
					shapeDef.parentIds.push(parId);

				if (shapeDef.childIds.indexOf(chldIdx) == -1)																		
					shapeDef.childIds.push(chldIdx);
				
				definedIdHistory.push(parId);			
				definedIdHistory.push(chldIdx);
			}			
			
			// We need to examine if any shapes overlap on top of each other.
			// If they do, we define the shape inside of another shape as a hole.
			// We will compare two items (A, B) at time:
			// 1) Do a quick overlap test by creating a bounding rectangle on each shape.
			// 2) If they do overlap, use raycasting technique to examine if one point on A is inside B.
			// 3) If the point of A is inside B, We define A as a hole of B.
			// 4) If the point of B is inside A, We define B as a hole of A.
			
			// To avoid comparing same shapes twice:
			// 1) Remove the first shape from curShapes2 on each iteration
			// 2) Compaire the current shape in curShapes with all shapes in curShapes2				
			curShapes2.shift();			
			if (setIdHistory.indexOf(shpIdx) == -1)
			{
				var shapeA = curShapes[shpIdx];			
				for (var shpIdx2 = 0; shpIdx2 < curShapes2.length; shpIdx2++)
				{				
					var shapeB = curShapes2[shpIdx2];
					var shapeB_TrueIdx = curShapes.length - curShapes2.length +shpIdx2;
					
					if (setIdHistory.indexOf(shapeB_TrueIdx) == -1)
					{	
						// Does rects overlap?				
						if (this.checkIfRectOverlap(shapeA, shapeB))
						{							
							// Is ShapeA inside B?
							if (this.pointIsInPoly(shapeA, 12 /*number of samples*/, shapeB))							
								storeDefinition(shapeB_TrueIdx, shpIdx);
							else						
								// Is ShapeB inside A?
								if (this.pointIsInPoly(shapeB, 12 /*number of samples*/, shapeA))									
									storeDefinition(shpIdx, shapeB_TrueIdx);						
						}
					}
				}
			}
		}
		for (var cs2 = 0; cs2 < curShapes.length; cs2++)
			if (definedIdHistory.indexOf(cs2) == -1 && setIdHistory.indexOf(cs2) == -1)
				shapeDef.singleIds.push(cs2);			

		return shapeDef;
	};
	
	
	this.checkIfRectOverlap = function(polygonA, polygonB)
	{
		// This function is written based on the following resource:		
		// https://www.geeksforgeeks.org/find-two-rectangles-overlap/
	
		// Each polygon is an array containing cubic bezier curves that make up a closed vector shape
		// One bezier contains 4 pairs of XY coords; p0, p1 is for points and p2, p3 for handles
		// Because a bezier p1 always has the same XY coord of next p0. We can also ignore p2 and p3;
		// means, we only need to parse p0 of every bezier curves.
		// Exception is when a polygon has only 2 vertices since that will be seen as a line segment instead of a surface.
		function createRect(polygon)
		{		
			var minX = polygon[0].x;
			var maxX = polygon[0].x;
			var minY = polygon[0].y;
			var maxY = polygon[0].y;		

			var step = (polygon.length <= 8)? 1: 4;			
			for (var n = step; n < polygon.length; n+=step)
			{
				minX = Math.min(polygon[n].x, minX);
				maxX = Math.max(polygon[n].x, maxX);
				minY = Math.min(polygon[n].y, minY);
				maxY = Math.max(polygon[n].y, maxY);			
			}
			return {min: {x: minX, y: minY}, max: {x: maxX, y: maxY} };
		}				
		var rectA = createRect(polygonA);
		var rectB = createRect(polygonB);
		
		if (rectA.min.x > rectB.max.x || rectA.min.y > rectB.max.y ||
			rectB.min.x > rectA.max.x || rectB.min.y > rectA.max.y)
			return false;
		
		else 
			return true;	
	};


	this.pointIsInPoly = function(polygon1, numSamples, polygon2)
	{
		// This function is written based on the following resource:
		// https://stackoverflow.com/questions/217578/how-can-i-determine-whether-a-2d-point-is-within-a-polygon
		
		// If polygon1 has only 2 vertices just use all points( including handle points for the test)
		if(polygon1.length <= 8)
		{
			var arrayP1 = polygon1;
			var poly1Step = 1;
		// Filter p0
		}
		else
		{
			var arrayP1 = [];
			for (var n = 0; n < polygon1.length; n += 4)
				 arrayP1.push(polygon1[n]);
			var poly1Step = (numSamples < arrayP1.length)? Math.round(arrayP1.length / numSamples) : 1;	
		}
		var insideCount = 0, actualNumSamples = 0;		
		for (var p1 = 0; p1 < arrayP1.length; p1 += poly1Step)
		{
			var isInside = false;			
			var p = arrayP1[p1];
			var j = polygon2.length -1;			
			var i = 0;
			var poly2Step = (j <= 7)? 1: 4;
			for (i, j; i < polygon2.length; j = i, i +=poly2Step)
			{
				var conditionA = (polygon2[i].y > p.y) != (polygon2[j].y > p.y);
				var conditionB = p.x < (polygon2[j].x -polygon2[i].x) *(p.y - polygon2[i].y) /(polygon2[j].y - polygon2[i].y) +polygon2[i].x;
				
				if (conditionA && conditionB)
					isInside = !isInside;
			}
			if (isInside)
				insideCount++;

			actualNumSamples++;			
		}

		var confidence = 100 /actualNumSamples *insideCount;
		if (confidence > 66)
			return true;			
		else		
			return false;
	};	
}