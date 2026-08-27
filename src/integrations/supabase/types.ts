export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      batches: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label_profile_id: string | null
          name: string
          project_id: string
          status: Database["public"]["Enums"]["batch_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label_profile_id?: string | null
          name: string
          project_id: string
          status?: Database["public"]["Enums"]["batch_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label_profile_id?: string | null
          name?: string
          project_id?: string
          status?: Database["public"]["Enums"]["batch_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "batches_label_profile_id_fkey"
            columns: ["label_profile_id"]
            isOneToOne: false
            referencedRelation: "label_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      benchmark_field_results: {
        Row: {
          created_at: string
          failure_pattern: string | null
          field_key: string
          field_label: string | null
          id: string
          match_rate: number
          matched: number
          mismatches: Json
          missed: number
          near_matched: number
          precision_score: number
          recall_score: number
          rejected: number
          run_id: string
          total: number
        }
        Insert: {
          created_at?: string
          failure_pattern?: string | null
          field_key: string
          field_label?: string | null
          id?: string
          match_rate?: number
          matched?: number
          mismatches?: Json
          missed?: number
          near_matched?: number
          precision_score?: number
          recall_score?: number
          rejected?: number
          run_id: string
          total?: number
        }
        Update: {
          created_at?: string
          failure_pattern?: string | null
          field_key?: string
          field_label?: string | null
          id?: string
          match_rate?: number
          matched?: number
          mismatches?: Json
          missed?: number
          near_matched?: number
          precision_score?: number
          recall_score?: number
          rejected?: number
          run_id?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "benchmark_field_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "benchmark_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      benchmark_runs: {
        Row: {
          batch_ids: string[]
          batch_labels: string[]
          comparisons: number
          created_at: string
          created_by: string | null
          documents_evaluated: number
          fields_evaluated: number
          id: string
          name: string
          overall_score: number
          profile_ids: string[]
          profile_labels: string[]
          project_id: string
        }
        Insert: {
          batch_ids?: string[]
          batch_labels?: string[]
          comparisons?: number
          created_at?: string
          created_by?: string | null
          documents_evaluated?: number
          fields_evaluated?: number
          id?: string
          name: string
          overall_score?: number
          profile_ids?: string[]
          profile_labels?: string[]
          project_id: string
        }
        Update: {
          batch_ids?: string[]
          batch_labels?: string[]
          comparisons?: number
          created_at?: string
          created_by?: string | null
          documents_evaluated?: number
          fields_evaluated?: number
          id?: string
          name?: string
          overall_score?: number
          profile_ids?: string[]
          profile_labels?: string[]
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "benchmark_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          batch_id: string
          error_message: string | null
          extracted_text: string | null
          file_type: string
          filename: string
          id: string
          is_synthetic: boolean
          page_count: number
          status: Database["public"]["Enums"]["document_status"]
          storage_path: string | null
          updated_at: string
          uploaded_at: string
        }
        Insert: {
          batch_id: string
          error_message?: string | null
          extracted_text?: string | null
          file_type?: string
          filename: string
          id?: string
          is_synthetic?: boolean
          page_count?: number
          status?: Database["public"]["Enums"]["document_status"]
          storage_path?: string | null
          updated_at?: string
          uploaded_at?: string
        }
        Update: {
          batch_id?: string
          error_message?: string | null
          extracted_text?: string | null
          file_type?: string
          filename?: string
          id?: string
          is_synthetic?: boolean
          page_count?: number
          status?: Database["public"]["Enums"]["document_status"]
          storage_path?: string | null
          updated_at?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
        ]
      }
      extractions: {
        Row: {
          confidence: number | null
          created_at: string
          data_type: Database["public"]["Enums"]["field_data_type"]
          document_id: string
          evidence_bbox: Json | null
          evidence_page: number | null
          evidence_snippet: string | null
          field_key: string
          field_label: string | null
          final_value: string | null
          id: string
          review_state: Database["public"]["Enums"]["extraction_review_state"]
          reviewed_at: string | null
          reviewed_by: string | null
          suggested_value: string | null
          updated_at: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          data_type?: Database["public"]["Enums"]["field_data_type"]
          document_id: string
          evidence_bbox?: Json | null
          evidence_page?: number | null
          evidence_snippet?: string | null
          field_key: string
          field_label?: string | null
          final_value?: string | null
          id?: string
          review_state?: Database["public"]["Enums"]["extraction_review_state"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          suggested_value?: string | null
          updated_at?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          data_type?: Database["public"]["Enums"]["field_data_type"]
          document_id?: string
          evidence_bbox?: Json | null
          evidence_page?: number | null
          evidence_snippet?: string | null
          field_key?: string
          field_label?: string | null
          final_value?: string | null
          id?: string
          review_state?: Database["public"]["Enums"]["extraction_review_state"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          suggested_value?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "extractions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      field_library: {
        Row: {
          bucket: string
          created_at: string
          data_type: Database["public"]["Enums"]["field_data_type"]
          description: string | null
          display_name: string
          id: string
          key: string
          sort_order: number
        }
        Insert: {
          bucket: string
          created_at?: string
          data_type?: Database["public"]["Enums"]["field_data_type"]
          description?: string | null
          display_name: string
          id?: string
          key: string
          sort_order?: number
        }
        Update: {
          bucket?: string
          created_at?: string
          data_type?: Database["public"]["Enums"]["field_data_type"]
          description?: string | null
          display_name?: string
          id?: string
          key?: string
          sort_order?: number
        }
        Relationships: []
      }
      finetune_jobs: {
        Row: {
          base_model: string
          batch_ids: string[]
          callback_token: string
          created_at: string
          created_by: string | null
          date_from: string | null
          date_to: string | null
          document_count: number
          error_message: string | null
          finished_at: string | null
          id: string
          logs: Json
          name: string
          pair_count: number
          profile_ids: string[]
          project_id: string
          result_model: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["finetune_job_status"]
          updated_at: string
        }
        Insert: {
          base_model: string
          batch_ids?: string[]
          callback_token?: string
          created_at?: string
          created_by?: string | null
          date_from?: string | null
          date_to?: string | null
          document_count?: number
          error_message?: string | null
          finished_at?: string | null
          id?: string
          logs?: Json
          name: string
          pair_count?: number
          profile_ids?: string[]
          project_id: string
          result_model?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["finetune_job_status"]
          updated_at?: string
        }
        Update: {
          base_model?: string
          batch_ids?: string[]
          callback_token?: string
          created_at?: string
          created_by?: string | null
          date_from?: string | null
          date_to?: string | null
          document_count?: number
          error_message?: string | null
          finished_at?: string | null
          id?: string
          logs?: Json
          name?: string
          pair_count?: number
          profile_ids?: string[]
          project_id?: string
          result_model?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["finetune_job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "finetune_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      label_profiles: {
        Row: {
          created_at: string
          created_by: string | null
          document_type: string | null
          fields: Json
          id: string
          model_config: Json
          name: string
          project_id: string
          status: Database["public"]["Enums"]["profile_status"]
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          document_type?: string | null
          fields?: Json
          id?: string
          model_config?: Json
          name: string
          project_id: string
          status?: Database["public"]["Enums"]["profile_status"]
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          document_type?: string | null
          fields?: Json
          id?: string
          model_config?: Json
          name?: string
          project_id?: string
          status?: Database["public"]["Enums"]["profile_status"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "label_profiles_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      model_connectors: {
        Row: {
          api_key: string | null
          auth_type: string
          base_url: string | null
          created_at: string
          custom_headers: Json
          id: string
          is_default: boolean
          kind: Database["public"]["Enums"]["connector_kind"]
          model_name: string
          name: string
          project_id: string
          provider: string
          updated_at: string
        }
        Insert: {
          api_key?: string | null
          auth_type?: string
          base_url?: string | null
          created_at?: string
          custom_headers?: Json
          id?: string
          is_default?: boolean
          kind?: Database["public"]["Enums"]["connector_kind"]
          model_name: string
          name: string
          project_id: string
          provider: string
          updated_at?: string
        }
        Update: {
          api_key?: string | null
          auth_type?: string
          base_url?: string | null
          created_at?: string
          custom_headers?: Json
          id?: string
          is_default?: boolean
          kind?: Database["public"]["Enums"]["connector_kind"]
          model_name?: string
          name?: string
          project_id?: string
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_connectors_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_members: {
        Row: {
          access: Database["public"]["Enums"]["member_access"]
          created_at: string
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          access?: Database["public"]["Enums"]["member_access"]
          created_at?: string
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          access?: Database["public"]["Enums"]["member_access"]
          created_at?: string
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived: boolean
          created_at: string
          description: string | null
          id: string
          name: string
          owner_id: string
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_type: Database["public"]["Enums"]["workspace_type"]
        }
        Insert: {
          archived?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name: string
          owner_id: string
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          workspace_type?: Database["public"]["Enums"]["workspace_type"]
        }
        Update: {
          archived?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          owner_id?: string
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          workspace_type?: Database["public"]["Enums"]["workspace_type"]
        }
        Relationships: []
      }
      rlhf_exports: {
        Row: {
          created_at: string
          created_by: string | null
          filters: Json
          format: string
          id: string
          name: string
          pair_count: number
          payload: Json
          project_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          filters?: Json
          format?: string
          id?: string
          name: string
          pair_count?: number
          payload?: Json
          project_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          filters?: Json
          format?: string
          id?: string
          name?: string
          pair_count?: number
          payload?: Json
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rlhf_exports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      synthetic_records: {
        Row: {
          accepted_document_id: string | null
          batch_id: string | null
          constraints_note: string | null
          created_at: string
          created_by: string | null
          fields: Json
          id: string
          label_profile_id: string
          project_id: string
          status: Database["public"]["Enums"]["synthetic_record_status"]
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          accepted_document_id?: string | null
          batch_id?: string | null
          constraints_note?: string | null
          created_at?: string
          created_by?: string | null
          fields?: Json
          id?: string
          label_profile_id: string
          project_id: string
          status?: Database["public"]["Enums"]["synthetic_record_status"]
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          accepted_document_id?: string | null
          batch_id?: string | null
          constraints_note?: string | null
          created_at?: string
          created_by?: string | null
          fields?: Json
          id?: string
          label_profile_id?: string
          project_id?: string
          status?: Database["public"]["Enums"]["synthetic_record_status"]
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "synthetic_records_accepted_document_id_fkey"
            columns: ["accepted_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "synthetic_records_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "synthetic_records_label_profile_id_fkey"
            columns: ["label_profile_id"]
            isOneToOne: false
            referencedRelation: "label_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "synthetic_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_batch: { Args: { _batch_id: string }; Returns: boolean }
      can_access_benchmark_run: { Args: { _run_id: string }; Returns: boolean }
      can_access_document: { Args: { _document_id: string }; Returns: boolean }
      can_access_project: { Args: { _project_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_project_member: { Args: { _project_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "member"
      batch_status:
        | "uploaded"
        | "processing"
        | "prelabeled"
        | "in_review"
        | "complete"
      connector_kind: "hosted" | "self_hosted"
      document_status:
        | "uploaded"
        | "processing"
        | "prelabeled"
        | "in_review"
        | "approved"
        | "rejected"
      extraction_review_state:
        | "pending"
        | "accepted"
        | "corrected"
        | "rejected"
        | "locked"
      field_data_type:
        | "text"
        | "identifier"
        | "date"
        | "currency"
        | "number"
        | "boolean"
        | "multi_value"
      finetune_job_status: "queued" | "running" | "complete" | "failed"
      member_access: "owner" | "editor" | "viewer"
      profile_status: "draft" | "published" | "archived"
      project_status: "active" | "paused" | "completed" | "archived"
      synthetic_record_status: "pending" | "accepted" | "discarded"
      workspace_type:
        | "finance"
        | "healthcare"
        | "legal"
        | "manufacturing"
        | "insurance"
        | "logistics"
        | "general"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "member"],
      batch_status: [
        "uploaded",
        "processing",
        "prelabeled",
        "in_review",
        "complete",
      ],
      connector_kind: ["hosted", "self_hosted"],
      document_status: [
        "uploaded",
        "processing",
        "prelabeled",
        "in_review",
        "approved",
        "rejected",
      ],
      extraction_review_state: [
        "pending",
        "accepted",
        "corrected",
        "rejected",
        "locked",
      ],
      field_data_type: [
        "text",
        "identifier",
        "date",
        "currency",
        "number",
        "boolean",
        "multi_value",
      ],
      finetune_job_status: ["queued", "running", "complete", "failed"],
      member_access: ["owner", "editor", "viewer"],
      profile_status: ["draft", "published", "archived"],
      project_status: ["active", "paused", "completed", "archived"],
      synthetic_record_status: ["pending", "accepted", "discarded"],
      workspace_type: [
        "finance",
        "healthcare",
        "legal",
        "manufacturing",
        "insurance",
        "logistics",
        "general",
      ],
    },
  },
} as const
