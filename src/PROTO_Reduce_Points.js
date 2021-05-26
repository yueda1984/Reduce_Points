var fitCurveJS = require("./lib/fit-curve.js");

function PROTO_Smooth_Drawings()
{
	var maxError = 10;
	
	
	//var MT = new mathLibrary.math;	
	var FT = new fitCurveJS.fitCurveMaster;	
	
	var sNodes = selection.selectedNodes();
	sNodes = sNodes.filter( function(item){ return node.type(item) === "READ"; } );

	scene.beginUndoRedoAccum( "" );
	
	for ( var sn = 0; sn < sNodes.length; sn++ ){		
		var useTiming = node.getAttr( sNodes[sn], 1, "drawing.elementMode" ).boolValue();
		var drawCol = node.linkedColumn( sNodes[sn], useTiming ? "drawing.element" : "drawing.customName.timing" );	
		var usedCelHistory = [];
		for ( var fr = 1; fr <= frame.numberOf(); fr++ ){
			var curCel = column.getEntry( drawCol, 1, fr );	
			if( usedCelHistory.indexOf( curCel ) !== -1 )
				continue;
			else
				usedCelHistory.push( curCel );
			for ( var at = 0; at < 4; at++ ){			
				var nodeDef = { node: sNodes[sn], frame: fr };
				var shapeInfo = { drawing: nodeDef, art: at };
				var shapes = Drawing.query.getStrokes( shapeInfo );
				//MessageLog.trace( JSON.stringify( shapes ) );	

				if( !shapes )
					continue

				
				// Clear the current art layer.
				var layerList = [];
				for( var ly = 0; ly < shapes.layers.length; ly++ )
					layerList.push( ly );				
				var layersDef = { drawing: nodeDef, art: at, layers: layerList };		
				DrawingTools.deleteLayers( layersDef );
					
					
				for ( var ly = 0; ly < shapes.layers.length; ly++ ){
					var colorId = shapes.layers[ly].shaders[0].colorId;
					var points = [];
					for ( var st = 0; st < shapes.layers[ly].strokes.length; st++ ){	
						var stroke = shapes.layers[ly].strokes[st];
						var def = { precision: 3, path: stroke.path };
						var discretizedPath = Drawing.geometry.discretize(def);
						discretizedPath.forEach( function(item){ points.push( [ item.x, item.y ] ) } );
					}

					var fittedBezier = FT.fitCurve( points, maxError );
					var reducedPath = [];
					for ( var fb = 0; fb < fittedBezier.length; fb++ ){
						reducedPath.push( { x: fittedBezier[fb][0][0], y: fittedBezier[fb][0][1], onCurve: true } );
						reducedPath.push( { x: fittedBezier[fb][1][0], y: fittedBezier[fb][1][1], onCurve: false } );
						reducedPath.push( { x: fittedBezier[fb][2][0], y: fittedBezier[fb][2][1], onCurve: false } );
						
						if( fb === fittedBezier.length -1 )
							reducedPath.push( { x: fittedBezier[fb][3][0], y: fittedBezier[fb][3][1], onCurve: true } );
					}

					var newLayerDef = {
						drawing : { node: sNodes[sn], frame: fr },
						art: at,
						layers : [{
							shaders : [ { colorId : colorId } ],
							under : false,
							strokes : [{
									shaderLeft: 0,								
									path: reducedPath
							}]
						}]
					}   
					DrawingTools.createLayers( newLayerDef );
				}
			}
		}
	}
	scene.endUndoRedoAccum();	
}


function privateFunctions()
{
	
}