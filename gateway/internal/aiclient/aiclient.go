package aiclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client talks to the Python AI service.
type Client struct {
	baseURL      string
	httpClient   *http.Client
	streamClient *http.Client // no timeout — rely on context cancellation
}

// New returns a Client targeting baseURL.
func New(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 20 * time.Second,
		},
		streamClient: &http.Client{
			Timeout: 0, // streaming responses; caller controls lifetime via context
		},
	}
}

type chatRequest struct {
	SessionID string `json:"session_id"`
	Message   string `json:"message"`
}

type chatResponse struct {
	Reply string `json:"reply"`
}

type CoverageCheckRequest struct {
	PatientID string `json:"patient_id"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	DOB       string `json:"dob"`
	PayerName string `json:"payer_name"`
	MemberID  string `json:"member_id"`
}

type CoverageCheckResponse struct {
	OK       bool           `json:"ok"`
	Payer    string         `json:"payer"`
	Eligible bool           `json:"eligible"`
	Coverage map[string]any `json:"coverage"`
}

// TriggerFAQEmbed asks the AI service to re-embed all published FAQs.
// It is fire-and-forget: the gateway calls it in a goroutine after FAQ writes
// so embeddings stay fresh without blocking the admin response.
// Failures are logged but not propagated.
func (c *Client) TriggerFAQEmbed(log func(msg string, args ...any)) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/internal/embed-faqs", nil)
	if err != nil {
		log("aiclient: build embed-faqs request", "err", err)
		return
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		log("aiclient: trigger embed-faqs", "err", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log("aiclient: embed-faqs unexpected status", "status", resp.StatusCode)
	}
}

// TriggerBlogEmbed asks the AI service to embed a single blog post by id.
// It is fire-and-forget: the gateway calls it in a goroutine after blog writes
// so the post joins the semantic-dedup corpus without blocking the admin response.
// Failures are logged but not propagated.
func (c *Client) TriggerBlogEmbed(id int64, log func(msg string, args ...any)) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	body, err := json.Marshal(map[string]int64{"id": id})
	if err != nil {
		log("aiclient: marshal embed-blog request", "err", err)
		return
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/internal/embed-blog", bytes.NewReader(body))
	if err != nil {
		log("aiclient: build embed-blog request", "err", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		log("aiclient: trigger embed-blog", "err", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log("aiclient: embed-blog unexpected status", "status", resp.StatusCode)
	}
}

// Chat sends a message to the AI service and returns its reply.
func (c *Client) Chat(ctx context.Context, sessionID, message string) (string, error) {
	reqBody, err := json.Marshal(chatRequest{SessionID: sessionID, Message: message})
	if err != nil {
		return "", fmt.Errorf("aiclient: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat", bytes.NewReader(reqBody))
	if err != nil {
		return "", fmt.Errorf("aiclient: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("aiclient: do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("aiclient: unexpected status %d", resp.StatusCode)
	}

	var out chatResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out); err != nil {
		return "", fmt.Errorf("aiclient: decode response: %w", err)
	}

	return out.Reply, nil
}

// ChatStream opens a streaming POST to the AI service /chat/stream endpoint.
// Returns the raw response so the caller can pipe the SSE body to the client.
// Caller is responsible for closing the response body.
func (c *Client) ChatStream(ctx context.Context, sessionID, message string) (*http.Response, error) {
	reqBody, err := json.Marshal(chatRequest{SessionID: sessionID, Message: message})
	if err != nil {
		return nil, fmt.Errorf("aiclient: marshal stream request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/stream", bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("aiclient: build stream request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.streamClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("aiclient: do stream request: %w", err)
	}

	return resp, nil
}

// CheckCoverage verifies insurance details through the AI service's internal coverage endpoint.
func (c *Client) CheckCoverage(ctx context.Context, in CoverageCheckRequest) (CoverageCheckResponse, error) {
	reqBody, err := json.Marshal(in)
	if err != nil {
		return CoverageCheckResponse{}, fmt.Errorf("aiclient: marshal coverage request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/internal/intake/check-coverage", bytes.NewReader(reqBody))
	if err != nil {
		return CoverageCheckResponse{}, fmt.Errorf("aiclient: build coverage request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return CoverageCheckResponse{}, fmt.Errorf("aiclient: do coverage request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return CoverageCheckResponse{}, fmt.Errorf("aiclient: coverage status %d: %s", resp.StatusCode, string(body))
	}

	var out CoverageCheckResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out); err != nil {
		return CoverageCheckResponse{}, fmt.Errorf("aiclient: decode coverage response: %w", err)
	}

	return out, nil
}
