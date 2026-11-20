// Things the user can add to a shot from the storyboard's drawing view (Add → Things): quick pencil
// studies in the same stroke format as Claude's own (src/storyboard.ts Stroke), each drawn in a
// 300 x 300 box. Added to a shot, they become one object of its drawing (named, marked as the user's),
// which the user moves and resizes, and Claude reads as "the user wants a <name> here".
// Pure: no DOM.
import type { Stroke } from "./storyboard.ts";
import { pathBox, transformPath } from "./sketchObjects.ts";

export type Thing = { name: string; strokes: { d: string; shade?: number; color?: string }[] };

/**
 * Each drawn by Claude as a realistic pencil study (drawPrompt, three-quarter views, every part its
 * own shaded, coloured shape) and kept here, so Add → Things is instant and the same every time.
 */
export const THINGS: Thing[] = [
  { name: "person", strokes: [
    {d: "M128 262 C124 230 122 200 126 170 L158 170 C160 200 160 232 158 262 L140 266 Z",shade: 0.55,color: "#2f3a4a"},
    {d: "M160 262 C162 230 164 200 164 170 L192 170 C196 200 190 232 182 264 L166 266 Z",shade: 0.5,color: "#323d4e"},
    {d: "M112 108 C116 92 134 86 150 88 C172 88 190 96 194 114 L198 176 C180 184 148 186 120 180 Z",shade: 0.5,color: "#5a6b7a"},
    {d: "M112 108 C98 118 92 150 94 178 C98 184 106 184 110 178 C112 156 118 132 124 116 Z",shade: 0.48,color: "#566676"},
    {d: "M190 108 C204 120 210 150 208 176 C204 182 196 182 192 176 C190 154 186 134 182 116 Z",shade: 0.42,color: "#5a6b7a"},
    {d: "M94 178 C90 186 90 194 96 198 C104 198 108 190 110 180 Z",shade: 0.3,color: "#c49a7c"},
    {d: "M208 176 C212 186 210 194 204 198 C196 196 192 188 192 178 Z",shade: 0.3,color: "#c49a7c"},
    {d: "M140 80 C138 88 138 92 136 96 C146 102 160 102 168 94 C164 90 164 86 164 78 Z",shade: 0.3,color: "#b88c6e"},
    {d: "M134 52 C134 36 146 26 160 28 C174 30 182 42 180 58 C180 72 172 84 158 86 C144 86 134 72 134 52 Z",shade: 0.3,color: "#c9a083"},
    {d: "M132 54 C128 34 142 20 160 22 C178 22 188 36 182 54 C178 44 172 38 160 36 C148 36 138 40 132 54 Z",shade: 0.78,color: "#3a2a20"},
    {d: "M126 264 C120 268 118 274 126 278 L156 278 C160 272 158 266 156 264 Z",shade: 0.8},
    {d: "M166 266 C164 272 166 278 174 280 L198 278 C198 270 188 264 182 264 Z",shade: 0.8},
    {d: "M120 180 C140 188 170 188 198 176"},
    {d: "M158 172 C159 200 159 232 158 262"},
    {d: "M150 90 C154 102 158 112 160 120"},
    {d: "M146 52 C148 54 150 54 152 52"},
    {d: "M166 52 C168 54 170 54 172 52"},
    {d: "M160 56 C158 62 158 64 162 66"},
    {d: "M152 74 C158 77 164 76 168 72"},
    {d: "M124 122 C120 140 118 158 116 176"},
    {d: "M186 124 C190 140 192 158 192 174"},
  ] },
  { name: "phone", strokes: [
    {d: "M100 52 C100 36 112 28 130 28 L178 28 C196 28 206 38 206 54 L214 246 C215 264 202 276 184 276 L124 276 C106 276 96 264 98 246 Z",shade: 0.75,color: "#2b2e35"},
    {d: "M108 56 C108 44 118 36 132 36 L174 36 C188 36 197 44 197 58 L204 242 C205 256 196 266 182 266 L126 266 C112 266 106 256 106 244 Z",shade: 0.3,color: "#1c1e22"},
    {d: "M118 60 C118 52 124 48 132 48 L172 48 C180 48 186 52 186 60 L192 236 C192 248 186 254 176 254 L132 254 C122 254 118 248 118 238 Z",shade: 0.85,color: "#3d7cc9"},
    {d: "M134 40 C140 38 160 38 168 40 C168 43 166 45 160 45 L142 45 C136 45 134 43 134 40 Z",shade: 0.6},
    {d: "M142 41 L160 41"},
    {d: "M172 41 A2.5 2.5 0 1 0 172.1 41 Z",shade: 0.7},
    {d: "M200 90 C204 90 205 92 205 94 L205 112 C205 114 203 114 201 114 Z",shade: 0.5},
    {d: "M98 96 C95 96 94 98 94 100 L94 118 C94 120 96 120 98 119 Z",shade: 0.5},
    {d: "M98 130 C95 130 94 132 94 134 L94 158 C94 160 96 160 98 159 Z",shade: 0.5},
    {d: "M126 62 C140 58 164 58 178 62 L184 150 C165 140 145 138 128 140 Z",shade: 0.5},
    {d: "M130 66 C142 63 162 63 174 66"},
    {d: "M128 140 C145 138 165 140 184 150"},
    {d: "M124 170 C124 164 130 160 136 160 C142 160 146 164 146 170 C146 176 140 180 134 180 C128 180 124 176 124 170 Z",shade: 0.35},
    {d: "M152 170 C152 164 158 160 164 160 C170 160 174 164 174 170 C174 176 168 180 162 180 C156 180 152 176 152 170 Z",shade: 0.35},
    {d: "M124 196 C124 190 130 186 136 186 C142 186 146 190 146 196 C146 202 140 206 134 206 C128 206 124 202 124 196 Z",shade: 0.35},
    {d: "M152 196 C152 190 158 186 164 186 C170 186 174 190 174 196 C174 202 168 206 162 206 C156 206 152 202 152 196 Z",shade: 0.35},
    {d: "M124 222 C124 216 130 212 136 212 C142 212 146 216 146 222 C146 228 140 232 134 232 C128 232 124 228 124 222 Z",shade: 0.35},
    {d: "M152 222 C152 216 158 212 164 212 C170 212 174 216 174 222 C174 228 168 232 162 232 C156 232 152 228 152 222 Z",shade: 0.35},
    {d: "M106 244 C106 256 112 266 126 266 L182 266 C196 266 205 256 204 242"},
  ] },
  { name: "laptop", strokes: [
    {d: "M70 190 L112 82 Q114 76 120 76 L238 70 Q244 70 242 76 L206 176 Q204 182 198 182 L76 196 Q68 197 70 190 Z",shade: 0.7},
    {d: "M80 184 L117 88 Q118 85 122 85 L229 80 Q233 80 232 84 L200 170 Q199 173 195 173 L84 187 Q79 188 80 184 Z",shade: 0.3,color: "#9aa7b5"},
    {d: "M58 214 L70 190 Q71 187 76 188 L198 176 Q204 176 206 182 L254 206 Q258 210 252 212 L112 240 Q100 242 90 238 L62 222 Q56 218 58 214 Z",shade: 0.55,color: "#8c8f94"},
    {d: "M62 222 L90 238 Q100 242 112 240 L252 212 L252 218 Q252 221 248 222 L112 248 Q98 250 88 245 L64 232 Q60 228 62 222 Z",shade: 0.75},
    {d: "M80 208 L192 192 L226 206 L112 226 Z",shade: 0.4,color: "#6e7076"},
    {d: "M88 208 L186 195 M96 212 L196 198 M104 216 L206 202 M112 221 L216 206 M93 205 L97 214 M117 202 L122 217 M141 199 L148 220 M166 196 L174 223 M189 193 L199 211"},
    {d: "M112 232 Q146 242 180 228 L214 220 Q222 218 218 224 L178 238 Q146 248 114 240 Z",shade: 0.45,color: "#a0a3a8"},
    {d: "M140 233 L172 227 L168 231 L142 236 Z",shade: 0.3},
    {d: "M118 92 L226 86 M120 90 Q118 120 108 160"},
    {d: "M158 130 Q166 122 176 128 Q168 136 158 130 Z",shade: 0.6,color: "#c5c9ce"},
    {d: "M70 190 Q72 187 76 188 L198 176 M242 76 Q244 70 238 70"},
  ] },
  { name: "car", strokes: [
    {d: "M32 205 C32 190 50 182 78 178 C100 176 112 160 140 150 C170 140 205 140 228 152 C245 160 258 172 270 180 C280 186 282 198 281 212 L279 224 C240 232 90 232 36 224 Z",color: "#b8332e"},
    {d: "M92 178 C108 164 124 154 144 150 C170 144 198 144 216 153 C226 158 236 168 246 178 C210 182 140 184 92 178 Z",shade: 0.3},
    {d: "M104 175 C116 165 128 158 143 155 L146 177 C132 178 118 177 104 175 Z",shade: 0.2},
    {d: "M152 154 C170 152 190 152 208 157 C218 162 226 168 232 176 L152 177 Z",shade: 0.2},
    {d: "M36 205 C60 210 90 213 130 214 C190 215 240 214 279 208 L279 224 C240 232 90 232 36 224 Z",shade: 0.6},
    {d: "M50 196 C58 192 70 192 78 196 L76 204 C66 203 56 202 50 200 Z",shade: 0.75},
    {d: "M262 190 C270 192 277 196 280 202 C272 203 264 202 258 200 Z",shade: 0.25},
    {d: "M70 226 C70 206 84 196 100 196 C116 196 130 208 130 226 C130 244 116 254 100 254 C84 254 70 244 70 226 Z",shade: 0.85},
    {d: "M200 226 C200 206 214 196 230 196 C246 196 260 208 260 226 C260 244 246 254 230 254 C214 254 200 244 200 226 Z",shade: 0.85},
    {d: "M86 226 C86 216 92 210 100 210 C108 210 115 216 115 226 C115 234 108 241 100 241 C92 241 86 234 86 226 Z",shade: 0.35},
    {d: "M216 226 C216 216 222 210 230 210 C238 210 245 216 245 226 C245 234 238 241 230 241 C222 241 216 234 216 226 Z",shade: 0.35},
    {d: "M96 226 C96 222 98 220 100 220 C103 220 105 222 105 226 C105 229 103 231 100 231 C98 231 96 229 96 226 Z",shade: 0.6},
    {d: "M226 226 C226 222 228 220 230 220 C233 220 235 222 235 226 C235 229 233 231 230 231 C228 231 226 229 226 226 Z",shade: 0.6},
    {d: "M146 150 L148 200"},
    {d: "M38 200 C80 204 200 206 278 200"},
    {d: "M215 153 C222 170 224 190 222 204"},
    {d: "M150 190 L162 190"},
    {d: "M226 172 L238 172"},
    {d: "M32 218 C34 212 36 208 40 206"},
  ] },
  { name: "rocket", strokes: [
    {d: "M150 28 C168 52 182 92 184 140 L184 214 L116 214 L116 140 C118 92 132 52 150 28 Z",shade: 0.3,color: "#c9c6c0"},
    {d: "M150 28 C142 44 134 62 130 84 C140 90 160 90 170 84 C166 62 158 44 150 28 Z",shade: 0.7,color: "#a8483a"},
    {d: "M116 150 C92 172 80 202 78 236 C96 226 108 222 116 222 Z",shade: 0.65,color: "#a8483a"},
    {d: "M184 150 C208 172 220 202 222 236 C204 226 192 222 184 222 Z",shade: 0.55,color: "#a8483a"},
    {d: "M142 160 C140 190 140 215 144 240 L156 240 C160 215 160 190 158 160 C154 152 146 152 142 160 Z",shade: 0.5,color: "#9a3f33"},
    {d: "M122 214 L178 214 L172 232 C160 238 140 238 128 232 Z",shade: 0.8,color: "#4a4744"},
    {d: "M134 232 C132 250 138 262 150 276 C162 262 168 250 166 232 C158 237 142 237 134 232 Z",shade: 0.2,color: "#e8a540"},
    {d: "M150 112 m-16 0 a16 16 0 1 0 32 0 a16 16 0 1 0 -32 0 Z",shade: 0.8,color: "#3f5a70"},
    {d: "M150 118 m-10 0 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 Z",shade: 0.35,color: "#7fa3bd"},
    {d: "M130 84 C140 92 160 92 170 84"},
    {d: "M118 140 C136 148 164 148 182 140"},
    {d: "M116 182 C136 190 164 190 184 182"},
    {d: "M116 214 C136 222 164 222 184 214"},
    {d: "M168 50 C176 78 178 110 178 200"},
    {d: "M144 108 C146 104 150 102 154 103"},
    {d: "M100 190 C94 204 90 216 88 228"},
    {d: "M200 190 C206 204 210 216 212 228"},
    {d: "M150 160 L150 238"},
  ] },
  { name: "satellite", strokes: [
    {d: "M120 120 L180 100 L200 150 L140 170 Z",shade: 0.45,color: "#b8b2a4"},
    {d: "M120 120 L140 170 L132 176 L110 128 Z",shade: 0.7},
    {d: "M120 120 L180 100 L176 94 L116 114 Z",shade: 0.3},
    {d: "M140 170 L200 150 L198 158 L142 178 Z",shade: 0.6},
    {d: "M60 105 L110 90 L118 150 L68 165 Z",shade: 0.75,color: "#2c3f6b"},
    {d: "M68 165 L118 150 L120 156 L70 172 Z",shade: 0.5},
    {d: "M190 82 L240 68 L252 128 L202 142 Z",shade: 0.75,color: "#2c3f6b"},
    {d: "M202 142 L252 128 L253 134 L203 148 Z",shade: 0.5},
    {d: "M118 135 L110 133 L98 134 L88 138 L80 140 L74 138 L76 134 L88 132 L110 128 Z",shade: 0.5},
    {d: "M200 130 L206 129 L214 130 L222 128 L224 124 L216 124 L204 126 Z",shade: 0.5},
    {d: "M150 190 C150 202 166 206 176 198 L186 180 L158 170 Z",shade: 0.55,color: "#9a9a9a"},
    {d: "M142 178 L158 190 L172 186 L190 160 L198 158 L200 150 L142 178 Z",shade: 0.5},
    {d: "M135 88 C140 70 160 62 178 72 L174 98 L132 108 Z",shade: 0.6,color: "#c8a24a"},
    {d: "M150 95 C150 78 164 70 176 76 C170 90 164 98 150 95 Z",shade: 0.4,color: "#d8d8d8"},
    {d: "M158 100 L156 78 L160 60 L162 78 L162 100 Z",shade: 0.4},
    {d: "M160 60 C158 52 162 46 168 44 C174 46 176 52 172 58 C168 62 162 62 160 60 Z",shade: 0.5,color: "#c0c0c0"},
    {d: "M70 110 L114 97 M72 124 L116 111 M74 138 L118 125 M76 152 L120 139"},
    {d: "M92 100 L98 158 M104 94 L110 154"},
    {d: "M194 88 L240 74 M196 102 L246 88 M198 116 L248 102 M200 130 L250 116"},
    {d: "M213 80 L222 138 M226 76 L236 134"},
    {d: "M124 130 L184 110 M130 148 L190 128"},
    {d: "M150 125 L152 160 M170 118 L172 152"},
    {d: "M118 130 L110 128 M200 132 L206 130"},
    {d: "M142 176 L198 156"},
  ] },
  { name: "building", strokes: [
    {d: "M60 95 L170 80 L170 265 L60 250 Z",shade: 0.35,color: "#a89a88"},
    {d: "M170 80 L240 98 L240 252 L170 265 Z",shade: 0.55,color: "#7d7266"},
    {d: "M54 95 L170 77 L246 97 L246 104 L170 86 L54 102 Z",shade: 0.7,color: "#5e564c"},
    {d: "M66 250 L170 265 L240 252 L240 258 L170 272 L66 257 Z",shade: 0.75,color: "#4a443d"},
    {d: "M75 112 L98 109.6 L98 139.4 L75 140.7 Z M75 153.4 L98 152.6 L98 182.4 L75 182 Z M75 194.8 L98 195.6 L98 225.3 L75 223.4 Z",shade: 0.8,color: "#3b4652"},
    {d: "M108 108.7 L131 106.2 L131 137.6 L108 138.9 Z M108 152.3 L131 151.5 L131 182.9 L108 182.6 Z M108 196 L131 196.8 L131 228.2 L108 226.3 Z",shade: 0.8,color: "#3b4652"},
    {d: "M141 105.1 L164 102.8 L164 135.7 L141 137 Z M141 151.1 L164 150.4 L164 183.4 L141 183 Z M141 197.1 L164 198 L164 231 L141 228.9 Z",shade: 0.8,color: "#3b4652"},
    {d: "M183 104.8 L203 109 L203 139.6 L183 137.1 Z M183 151.4 L203 153.3 L203 183.9 L183 183.9 Z",shade: 0.82,color: "#34404c"},
    {d: "M213 111 L231 114.6 L231 143.1 L213 140.9 Z M213 154.1 L231 155.7 L231 184.1 L213 184 Z",shade: 0.82,color: "#34404c"},
    {d: "M192 208 L212 203 L212 257.3 L192 263.9 Z",shade: 0.7,color: "#5a4634"},
    {d: "M170 80 L170 265"},
    {d: "M60 95 L60 250"},
    {d: "M240 98 L240 252"},
    {d: "M60 124 Q115 117 170 110"},
    {d: "M170 110 Q205 115 240 124"},
    {d: "M86.5 110.8 L86.5 140 M86.5 153 L86.5 182 M86.5 195 L86.5 224.5"},
    {d: "M119.5 107.5 L119.5 138 M119.5 152 L119.5 182.7 M119.5 196.4 L119.5 227"},
    {d: "M152.5 104 L152.5 136 M152.5 150.7 L152.5 183.2 M152.5 197.5 L152.5 230"},
    {d: "M193 121 L193 160 M222 126 L222 164"},
    {d: "M205 232 L206 233"},
    {d: "M60 192 Q115 198 170 205"},
    {d: "M170 205 Q205 197 240 190"},
  ] },
  { name: "chart", strokes: [
    {d: "M68 44 C110 40 180 36 226 36 C232 36 236 40 236 46 L238 262 C238 269 234 272 228 272 L72 276 C65 276 61 272 61 266 L62 52 C62 47 64 44 68 44 Z",shade: 0.55,color: "#8a5a32"},
    {d: "M82 62 C120 59 175 56 213 55 L221 250 C180 252 120 255 75 258 Z",shade: 0.15,color: "#ece6d6"},
    {d: "M122 40 C135 34 165 33 178 38 L177 58 C165 62 135 63 123 60 Z",shade: 0.6,color: "#8d9298"},
    {d: "M135 30 C145 26 158 26 166 30 L166 42 C158 45 145 45 135 42 Z",shade: 0.65,color: "#6e747a"},
    {d: "M101 214 L101 172 C108 170 114 170 121 171 L121 213 C114 215 108 215 101 214 Z",shade: 0.45,color: "#7a8fa3"},
    {d: "M129 213 L129 142 C136 140 142 140 149 141 L149 212 C142 214 136 214 129 213 Z",shade: 0.5,color: "#a05a4a"},
    {d: "M157 212 L157 157 C164 155 170 155 177 156 L177 211 C170 213 164 213 157 212 Z",shade: 0.45,color: "#7a8fa3"},
    {d: "M185 211 L185 112 C192 110 198 110 205 111 L205 210 C198 212 192 212 185 211 Z",shade: 0.55,color: "#b0803a"},
    {d: "M93 100 L95 216 L207 212"},
    {d: "M103 160 C130 126 158 142 196 98"},
    {d: "M186 97 L198 96 L195 108"},
    {d: "M92 74 C120 72 160 70 195 69"},
    {d: "M92 84 C110 83 135 82 155 81"},
    {d: "M96 232 C130 231 170 230 205 229"},
    {d: "M97 241 C120 240 145 239 170 238"},
    {d: "M101 172 C108 170 114 170 121 171"},
    {d: "M129 142 C136 140 142 140 149 141"},
    {d: "M185 112 C192 110 198 110 205 111"},
    {d: "M68 270 C66 200 66 120 66 56"},
  ] },
  { name: "money", strokes: [
    {d: "M50 140 Q80 155 115 170 L115 222 Q80 208 50 192 Z",shade: 0.5,color: "#7d8a6c"},
    {d: "M115 170 Q185 150 255 135 L255 186 Q185 205 115 222 Z",shade: 0.35,color: "#93a081"},
    {d: "M50 140 Q120 125 190 115 Q225 122 255 135 Q185 150 115 170 Q80 155 50 140 Z",shade: 0.2,color: "#b4c2a4"},
    {d: "M66 142 Q125 132 185 124 Q210 130 238 138 Q180 152 118 160 Q92 152 66 142 Z",shade: 0.28,color: "#a3b294"},
    {d: "M66 142 Q125 132 185 124 Q210 130 238 138 Q180 152 118 160 Q92 152 66 142 Z"},
    {d: "M122 147 C126 136 160 128 182 133 C180 145 146 153 122 147 Z",shade: 0.35,color: "#97a888"},
    {d: "M130 146 C135 138 160 134 174 136 C170 144 148 148 130 146 Z"},
    {d: "M74 144 Q78 147 82 149"},
    {d: "M228 138 Q224 141 218 143"},
    {d: "M80 134 Q120 127 160 121"},
    {d: "M58 148 Q85 160 115 175"},
    {d: "M50 150 Q83 165 115 181 M50 160 Q83 175 115 191 M50 170 Q83 184 115 200 M50 181 Q83 195 115 211"},
    {d: "M115 180 Q185 160 255 145 M115 190 Q185 171 255 156 M115 201 Q185 183 255 166 M115 211 Q185 194 255 176"},
    {d: "M50 140 Q80 155 115 170 L115 222 Q80 208 50 192 Z"},
    {d: "M115 170 Q185 150 255 135 L255 186 Q185 205 115 222 Z"},
    {d: "M115 170 L115 222"},
    {d: "M190 115 Q225 122 255 135"},
    {d: "M52 143 Q51 165 50 190"},
    {d: "M117 176 Q119 195 117 218"},
    {d: "M200 120 Q232 128 250 138"},
  ] },
  { name: "globe", strokes: [
    {d: "M70 140 A80 80 0 1 1 230 140 A80 80 0 1 1 70 140 Z",shade: 0.45,color: "#5f86a0"},
    {d: "M95 90 C115 85 130 100 125 118 C122 135 135 145 128 165 C120 185 108 180 105 160 C100 140 88 120 95 90 Z",shade: 0.5,color: "#8a9a63"},
    {d: "M160 80 C180 75 200 90 205 110 C210 130 195 145 185 140 C175 160 170 175 160 160 C155 140 150 100 160 80 Z",shade: 0.5,color: "#b49a6a"},
    {d: "M200 165 C212 160 218 170 210 180 C200 182 196 172 200 165 Z",shade: 0.5,color: "#8a9a63"},
    {d: "M90 254 C90 242 210 242 210 254 L210 262 C210 276 90 276 90 262 Z",shade: 0.7,color: "#6b4a2e"},
    {d: "M141 228 L159 228 L162 248 C155 252 145 252 138 248 Z",shade: 0.6,color: "#b08a4a"},
    {d: "M150 46 A94 94 0 0 0 150 234 L150 229 A89 89 0 0 1 150 51 Z",shade: 0.6,color: "#b08a4a"},
    {d: "M144 46 C144 40 156 40 156 46 C156 52 144 52 144 46 Z",shade: 0.6,color: "#b08a4a"},
    {d: "M70 140 C100 165 200 165 230 140"},
    {d: "M76 105 C105 124 195 124 224 105"},
    {d: "M80 175 C110 192 190 192 220 175"},
    {d: "M100 70 C125 82 175 82 200 70"},
    {d: "M150 60 C110 90 110 190 150 220"},
    {d: "M150 60 C190 90 190 190 150 220"},
    {d: "M90 258 C100 266 200 266 210 258"},
    {d: "M222 100 C232 120 232 160 218 185",shade: 0.3},
  ] },
  { name: "chip", strokes: [
    {d: "M70 130 L130 175 L130 193 L70 148 Z",shade: 0.8},
    {d: "M130 175 L240 140 L240 158 L130 193 Z",shade: 0.7},
    {d: "M70 130 Q72 126 80 124 L176 99 Q182 98 187 102 L238 138 Q242 142 236 144 L134 176 Q130 177 127 174 L72 134 Q69 132 70 130 Z",shade: 0.78},
    {d: "M76 152 L86 159 L84 175 L74 168 Z",shade: 0.3},
    {d: "M88 161 L98 168 L96 184 L86 177 Z",shade: 0.3},
    {d: "M100 170 L110 177 L108 193 L98 186 Z",shade: 0.3},
    {d: "M112 179 L122 186 L120 202 L110 195 Z",shade: 0.3},
    {d: "M141 189 L151 186 L152 202 L142 205 Z",shade: 0.32},
    {d: "M160 184 L170 181 L171 197 L161 200 Z",shade: 0.32},
    {d: "M178 178 L188 175 L189 191 L179 194 Z",shade: 0.32},
    {d: "M197 172 L207 169 L208 185 L198 188 Z",shade: 0.32},
    {d: "M216 166 L226 163 L227 179 L217 182 Z",shade: 0.32},
    {d: "M84 133 L178 108 L228 143 L133 170 Z"},
    {d: "M70 130 L130 175 L240 140"},
    {d: "M130 175 L130 193"},
    {d: "M70 148 L130 193 L240 158"},
    {d: "M96 134 Q100 131 104 134 Q100 139 96 134 Z",shade: 0.5},
    {d: "M120 140 Q165 126 205 138",shade: 0.5},
    {d: "M120 152 L190 130"},
    {d: "M150 125 L168 120 L172 126 L154 131 Z",shade: 0.55},
    {d: "M74 128 L176 100 L186 102"},
  ] },
  { name: "idea", strokes: [
    {d: "M150 20 C105 20 78 55 78 98 C78 128 94 148 108 166 C116 176 118 186 118 196 L182 196 C182 186 184 176 192 166 C206 148 222 128 222 98 C222 55 195 20 150 20 Z",shade: 0.2,color: "#d9d3b8"},
    {d: "M118 196 L182 196 C184 202 184 208 182 214 L118 214 C116 208 116 202 118 196 Z",shade: 0.4,color: "#a8a090"},
    {d: "M118 214 L182 214 L181 226 L119 226 Z",shade: 0.55,color: "#8a8a8a"},
    {d: "M119 226 L181 226 L180 238 L120 238 Z",shade: 0.6,color: "#7a7a7a"},
    {d: "M120 238 L180 238 L178 250 L122 250 Z",shade: 0.55,color: "#8a8a8a"},
    {d: "M122 250 L178 250 C176 262 166 270 150 272 C134 270 124 262 122 250 Z",shade: 0.8,color: "#3a3a3a"},
    {d: "M119 218 C140 224 160 224 181 218",shade: 0.5},
    {d: "M120 230 C140 236 160 236 180 230"},
    {d: "M121 242 C140 248 160 248 179 242"},
    {d: "M118 196 C135 202 165 202 182 196"},
    {d: "M132 196 C134 178 138 158 138 140"},
    {d: "M168 196 C166 178 162 158 162 140"},
    {d: "M138 140 C142 118 150 112 156 100 C160 92 154 84 146 88"},
    {d: "M162 140 C158 120 150 112 144 102 C140 94 146 86 152 90"},
    {d: "M138 140 L162 140"},
    {d: "M104 60 C112 44 126 34 142 30"},
    {d: "M92 98 C90 84 94 72 98 66"},
    {d: "M200 70 C206 82 208 96 204 110"},
    {d: "M108 150 C122 164 134 170 144 174"},
  ] },
  { name: "tree", strokes: [
    {d: "M128 205 C132 185 134 160 130 135 C128 118 126 105 122 92 L150 90 C152 110 158 130 166 150 C172 170 176 190 182 205 C165 210 145 210 128 205 Z",shade: 0.7,color: "#6b4a2f"},
    {d: "M150 90 C156 108 162 128 168 148 C174 168 178 188 182 205 C172 208 164 209 158 209 C160 185 158 150 152 120 Z",shade: 0.82,color: "#4a3220"},
    {d: "M130 205 C118 210 108 214 98 216 C110 210 118 204 124 196 Z",shade: 0.7,color: "#5a3e27"},
    {d: "M180 204 C192 208 202 212 214 214 C204 208 196 202 190 194 Z",shade: 0.75,color: "#5a3e27"},
    {d: "M134 150 C118 138 104 128 92 112 C96 108 100 108 104 112 C114 124 126 132 138 140 Z",shade: 0.65,color: "#6b4a2f"},
    {d: "M158 130 C172 116 188 104 204 94 C206 98 204 102 200 104 C186 112 174 122 164 136 Z",shade: 0.65,color: "#6b4a2f"},
    {d: "M60 120 C40 105 38 78 58 62 C60 40 88 30 108 40 C122 24 152 22 166 38 C186 28 214 38 218 58 C242 62 254 90 238 108 C246 128 228 148 206 146 C196 160 170 164 154 154 C138 166 110 164 98 152 C78 156 56 142 60 120 Z",shade: 0.35,color: "#5f7a4a"},
    {d: "M70 112 C62 96 70 80 84 74 C80 90 86 104 98 112 C110 120 124 120 134 114 C128 128 110 134 94 130 C82 128 74 122 70 112 Z",shade: 0.5,color: "#4a6238"},
    {d: "M150 112 C158 100 176 96 190 102 C200 108 204 120 198 130 C190 140 172 142 158 136 C148 130 144 120 150 112 Z",shade: 0.5,color: "#4a6238"},
    {d: "M176 52 C190 46 206 52 210 64 C196 66 184 62 176 52 Z",shade: 0.22,color: "#8aa268"},
    {d: "M92 58 C100 46 118 44 128 50 C118 60 104 64 92 58 Z",shade: 0.22,color: "#8aa268"},
    {d: "M132 72 C144 62 162 64 168 76 C156 84 142 82 132 72 Z",shade: 0.28,color: "#7d9660"},
    {d: "M200 84 C212 80 226 86 230 98 C218 102 206 96 200 84 Z",shade: 0.3,color: "#7d9660"},
    {d: "M66 92 C74 88 80 90 84 96"},
    {d: "M120 96 C130 102 140 102 148 98"},
    {d: "M210 120 C200 128 190 130 180 126"},
    {d: "M136 190 C140 170 140 150 136 130"},
    {d: "M148 200 C150 178 148 160 144 142"},
    {d: "M166 170 C170 182 172 192 174 200"},
    {d: "M112 140 C104 132 98 126 94 120"},
    {d: "M174 134 C182 126 190 120 198 114"},
  ] },
  { name: "speech bubble", strokes: [
    {d: "M70 70 C70 48 90 40 125 40 L205 40 C240 40 262 52 262 85 L262 130 C262 165 240 178 205 178 L150 178 C140 178 132 182 124 190 L88 228 C84 232 80 230 81 224 L88 182 C88 178 84 176 80 173 C68 164 70 150 70 130 Z",shade: 0.2,color: "#e8e4da"},
    {d: "M82 76 C84 58 100 52 128 52 L202 52 C228 52 248 60 250 86 L250 128 C250 154 232 166 204 166 L148 166 C134 166 124 172 116 180 L100 198 L103 172 C103 166 98 164 92 160 C82 154 82 144 82 128 Z",shade: 0.15,color: "#f4f1ea"},
    {d: "M70 70 C70 48 90 40 125 40 L205 40 C240 40 262 52 262 85 L262 130 C262 165 240 178 205 178 L150 178 C140 178 132 182 124 190 L88 228 C84 232 80 230 81 224 L88 182 C88 178 84 176 80 173 C68 164 70 150 70 130 Z"},
    {d: "M88 228 C84 232 80 230 81 224 L88 182 L124 190 Z",shade: 0.3,color: "#cfcabd"},
    {d: "M124 190 C132 182 140 178 150 178 L205 178",shade: 0.5},
    {d: "M96 72 C100 62 112 58 130 58 L200 58"},
    {d: "M244 90 C246 110 246 125 242 140"},
    {d: "M110 95 C130 92 170 92 200 95"},
    {d: "M110 112 C140 109 180 110 218 112"},
    {d: "M110 129 C130 127 160 127 190 129"},
    {d: "M96 150 C110 156 130 158 150 158"},
    {d: "M88 182 L103 176"},
    {d: "M262 85 C262 120 258 150 240 168"},
  ] },
];

/**
 * A thing's strokes placed on a frame `unitsTall` high (the frame is 1000 wide): centred, about a third
 * of the frame wide, named "<name>" (or "<name> 2" when the shot already has one) and marked as the user's.
 */
export function placeThing(thing: Thing, unitsTall: number, existing: Stroke[] = []): Stroke[] {
  const k = (Math.min(1000, unitsTall) * 0.32) / 300;
  const dx = 500 - 150 * k;
  const dy = unitsTall / 2 - 150 * k;
  const taken = new Set(existing.map((s) => s.object?.toLowerCase()).filter(Boolean));
  let name = thing.name;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${thing.name} ${n}`;
  return thing.strokes.map((s) => ({ d: transformPath(s.d, dx, dy, k, 0, 0), shade: s.shade, color: s.color, object: name, added: true }));
}

/**
 * A thing's strokes fitted into a box of the frame (in the drawing's units, the frame 1000 wide):
 * as big as fits, centred, named and marked as the user's. For a thing Claude drew where the user
 * put its placeholder.
 */
export function fitThing(thing: Thing, box: { x: number; y: number; w: number; h: number }, existing: Stroke[] = []): Stroke[] {
  const k = Math.min(box.w, box.h) / 300;
  const dx = box.x + (box.w - 300 * k) / 2;
  const dy = box.y + (box.h - 300 * k) / 2;
  const taken = new Set(existing.map((s) => s.object?.toLowerCase()).filter(Boolean));
  let name = thing.name;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${thing.name} ${n}`;
  return thing.strokes.map((s) => ({ d: transformPath(s.d, dx, dy, k, 0, 0), shade: s.shade, color: s.color, object: name, added: true }));
}

/** What Claude is asked, to draw one thing the user named, the way the library's things are drawn. */
export function drawPrompt(name: string): string {
  return [
    `Draw "${name}" for a film storyboard, the way a skilled artist does a realistic pencil study of it.`,
    "Answer with only a JSON array of strokes, nothing else: [{\"d\": \"M...\", \"shade\": 0.4, \"color\": \"#8a5a32\"}, \"M...\", ...].",
    "Each stroke is an SVG path `d` inside a 300 x 300 box (x right, y down, keep 20 units of margin), using only the commands M L Q C A Z (absolute).",
    "Creatro renders it like graphite: every shape that has a `shade` (0.15 light to 0.85 dark: how dark the material is) or a `color` (#rrggbb, its real, slightly muted colour) and closes on itself becomes a lit, rounded volume with a cast shadow; strokes without them are drawn as lines (contours, seams, details).",
    "So build it from its real parts, each its own closed, shaded shape (a lamp: the shade, its rim, the arm, the joint, the base; a glass: the bowl, the stem, the foot), with the lines for edges and details on top.",
    "Real proportions, a natural three-quarter view (not flat front-on), smooth curves (C and Q, not jagged lines), the silhouette that makes it recognisable at a glance.",
    "12 to 30 strokes, in the order an artist draws them: the big shapes first, then the parts, then the details.",
    "No text, no letters, no background, no ground line, no shadow (Creatro adds the shadow).",
  ].join("\n");
}

/** Claude's drawing, read from its answer: the strokes that are real paths (bad ones dropped). Throws when none are. */
export function parseDrawing(text: string): Thing["strokes"] {
  const at = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (at < 0 || end < at) throw new Error("Claude didn't answer with a drawing");
  const raw = JSON.parse(text.slice(at, end + 1)) as unknown[];
  const out = raw.flatMap((x) => {
    const st = typeof x === "string" ? { d: x } : x && typeof x === "object" && typeof (x as { d?: unknown }).d === "string" ? (x as { d: string; shade?: number }) : null;
    if (!st || !/^\s*M/i.test(st.d)) return [];
    // A stroke that is a dot, or leaves the drawing's box, is a slip: dropped.
    const b = pathBox(st.d);
    if (!b || b.w + b.h < 2 || b.x < -12 || b.y < -12 || b.x + b.w > 312 || b.y + b.h > 312) return [];
    const shade = typeof st.shade === "number" ? Math.min(0.9, Math.max(0, st.shade)) : undefined;
    const c = (st as { color?: unknown }).color;
    const color = typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : undefined;
    return [{ d: st.d, ...(shade ? { shade } : {}), ...(color ? { color } : {}) }];
  }).slice(0, 40);
  if (!out.length) throw new Error("Claude's drawing had no strokes Creatro could use");
  return out;
}
