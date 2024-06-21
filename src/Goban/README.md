

This directory contains primarily front end `Goban` functionality. 

The main class here is the `Goban` class, however because there is a lot of
code and functionality that get's bundled up into a `Goban`, we've broken up
that functionality across several files which implement different units of
functionality and we use class inheritance to stack them up to something
usable.




```mermaid
---
title: Goban functionality layers
---
classDiagram
    SVGRenderer --|> Goban : Rendering implementation
    CanvasRenderer --|> Goban: Rendering implementation
    Goban --|> OGSConnectivity : extends
    OGSConnectivity --|> InteractiveBase: extends
    InteractiveBase --|> GobanBase: extends
    
    

    class SVGRenderer {
        Final rendering functionality
    }
    class CanvasRenderer {
        Final rendering functionality
    }

    class Goban {
        Full functionality exposed
        Common DOM manipulation functionality for our renderers
    }

    class OGSConnectivity {
        Encapsulates socket connection logic
    }

    class InteractiveBase {
        General purpose interactive functionality
        No DOM expectations at this layer
    }

    class GobanBase {
        Very abstract base that the Engine can use to interact with the Goban
    }
```
