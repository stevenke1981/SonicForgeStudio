//! SonicForge Studio headless prototype core.
//!
//! The production project will split DSP, audio I/O, rendering, project I/O,
//! and recipes into separate crates. This dependency-free prototype keeps a
//! small deterministic synthesis path that can be compiled immediately.

pub mod project;
pub mod render;
pub mod sequence;
pub mod synth;
pub mod wav;

pub use project::{Project, Track};
pub use render::{render_demo, render_project, RenderError, RenderSpec};
pub use sequence::{NoteEvent, Pattern};
