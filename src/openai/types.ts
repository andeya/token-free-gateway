// ---- Request types ----

export interface ChatCompletionRequest {
	model: string;
	messages: ChatMessage[];
	tools?: ToolDefinition[];
	tool_choice?: ToolChoice;
	stream?: boolean;
	temperature?: number;
	max_tokens?: number;
	user?: string;
}

export type ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export interface SystemMessage {
	role: "system" | "developer";
	content: string;
}

export interface UserMessage {
	role: "user";
	content: string | ContentPart[];
}

export interface AssistantMessage {
	role: "assistant";
	content?: string | null;
	tool_calls?: ToolCallOutput[];
}

export interface ToolMessage {
	role: "tool";
	tool_call_id: string;
	content: string;
}

export interface ContentPart {
	type: "text" | "image_url";
	text?: string;
	image_url?: { url: string; detail?: string };
}

export interface ToolDefinition {
	type: "function";
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

export type ToolChoice =
	| "none"
	| "auto"
	| "required"
	| { type: "function"; function: { name: string } };

// ---- Response types (non-streaming) ----

export interface ChatCompletionResponse {
	id: string;
	object: "chat.completion";
	created: number;
	model: string;
	system_fingerprint?: string;
	choices: ChatCompletionChoice[];
	usage: Usage;
}

export interface ChatCompletionChoice {
	index: number;
	message: ResponseMessage;
	finish_reason: "stop" | "tool_calls" | "length";
}

export interface ResponseMessage {
	role: "assistant";
	content: string | null;
	tool_calls?: ToolCallOutput[];
}

export interface ToolCallOutput {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string;
	};
}

export interface Usage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

// ---- Streaming types (SSE) ----

export interface ChatCompletionChunk {
	id: string;
	object: "chat.completion.chunk";
	created: number;
	model: string;
	choices: ChunkChoice[];
}

export interface ChunkChoice {
	index: number;
	delta: ChunkDelta;
	finish_reason: "stop" | "tool_calls" | "length" | null;
}

export interface ChunkDelta {
	role?: "assistant";
	content?: string | null;
	tool_calls?: ToolCallDelta[];
}

export interface ToolCallDelta {
	index: number;
	id?: string;
	type?: "function";
	function?: {
		name?: string;
		arguments?: string;
	};
}

// ---- Models endpoint ----

export interface ModelObject {
	id: string;
	object: "model";
	created: number;
	owned_by: string;
}

export interface ModelListResponse {
	object: "list";
	data: ModelObject[];
}
