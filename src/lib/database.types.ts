
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "accounts": {
                  Row: {
                    "created_at": string,"household_id": string,"id": string,"institution": string | null,"is_archived": boolean,"is_liability": boolean | null,"last4": string | null,"name": string,"owner_user_id": string | null,"sort_order": number,"type": Database["public"]['Enums']["account_type"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"household_id": string,"id"?: string,"institution"?: string | null,"is_archived"?: boolean,"is_liability"?: never,"last4"?: string | null,"name": string,"owner_user_id"?: string | null,"sort_order"?: number,"type": Database["public"]['Enums']["account_type"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"household_id"?: string,"id"?: string,"institution"?: string | null,"is_archived"?: boolean,"is_liability"?: never,"last4"?: string | null,"name"?: string,"owner_user_id"?: string | null,"sort_order"?: number,"type"?: Database["public"]['Enums']["account_type"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "accounts_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "accounts_household_id_owner_user_id_fkey"
      columns: ["household_id","owner_user_id"]
isOneToOne: false
      referencedRelation: "household_members"
      referencedColumns: ["household_id","user_id"]
    }
                  ]
                },"balance_snapshots": {
                  Row: {
                    "account_id": string,"as_of": string,"balance_cents": number,"created_at": string,"household_id": string,"id": string,"import_id": string | null,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"as_of": string,"balance_cents": number,"created_at"?: string,"household_id": string,"id"?: string,"import_id"?: string | null,"source": string
                  }
                  Update: {
                    "account_id"?: string,"as_of"?: string,"balance_cents"?: number,"created_at"?: string,"household_id"?: string,"id"?: string,"import_id"?: string | null,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "balance_snapshots_household_id_account_id_fkey"
      columns: ["household_id","account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["household_id","id"]
    },{
      foreignKeyName: "balance_snapshots_import_id_fkey"
      columns: ["import_id"]
isOneToOne: false
      referencedRelation: "imports"
      referencedColumns: ["id"]
    }
                  ]
                },"household_members": {
                  Row: {
                    "created_at": string,"display_name": string,"household_id": string,"role": Database["public"]['Enums']["member_role"],"split_weight": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"household_id": string,"role"?: Database["public"]['Enums']["member_role"],"split_weight"?: number,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"household_id"?: string,"role"?: Database["public"]['Enums']["member_role"],"split_weight"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "household_members_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"households": {
                  Row: {
                    "created_at": string,"id": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"imports": {
                  Row: {
                    "account_id": string,"balance_at_export_cents": number | null,"created_at": string,"date_max": string | null,"date_min": string | null,"exported_on": string,"file_sha256": string,"format": string,"household_id": string,"id": string,"original_filename": string,"pending_replaced": boolean,"rows_duplicate": number,"rows_inserted": number,"rows_pending": number,"rows_skipped": number,"rows_total": number,"storage_path": string,"uploaded_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"balance_at_export_cents"?: number | null,"created_at"?: string,"date_max"?: string | null,"date_min"?: string | null,"exported_on": string,"file_sha256": string,"format": string,"household_id": string,"id"?: string,"original_filename": string,"pending_replaced"?: boolean,"rows_duplicate"?: number,"rows_inserted"?: number,"rows_pending"?: number,"rows_skipped"?: number,"rows_total"?: number,"storage_path": string,"uploaded_by"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"balance_at_export_cents"?: number | null,"created_at"?: string,"date_max"?: string | null,"date_min"?: string | null,"exported_on"?: string,"file_sha256"?: string,"format"?: string,"household_id"?: string,"id"?: string,"original_filename"?: string,"pending_replaced"?: boolean,"rows_duplicate"?: number,"rows_inserted"?: number,"rows_pending"?: number,"rows_skipped"?: number,"rows_total"?: number,"storage_path"?: string,"uploaded_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "imports_household_id_account_id_fkey"
      columns: ["household_id","account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["household_id","id"]
    }
                  ]
                },"transactions": {
                  Row: {
                    "account_id": string,"amount_cents": number,"bank_category": string | null,"created_at": string,"display_description": string,"fingerprint": string | null,"household_id": string,"id": string,"import_id": string | null,"notes": string | null,"occurrence": number | null,"posted_on": string,"raw_description": string,"status": Database["public"]['Enums']["txn_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"amount_cents": number,"bank_category"?: string | null,"created_at"?: string,"display_description": string,"fingerprint"?: string | null,"household_id": string,"id"?: string,"import_id"?: string | null,"notes"?: string | null,"occurrence"?: number | null,"posted_on": string,"raw_description": string,"status": Database["public"]['Enums']["txn_status"],"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"amount_cents"?: number,"bank_category"?: string | null,"created_at"?: string,"display_description"?: string,"fingerprint"?: string | null,"household_id"?: string,"id"?: string,"import_id"?: string | null,"notes"?: string | null,"occurrence"?: number | null,"posted_on"?: string,"raw_description"?: string,"status"?: Database["public"]['Enums']["txn_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "transactions_household_id_account_id_fkey"
      columns: ["household_id","account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["household_id","id"]
    },{
      foreignKeyName: "transactions_import_id_fkey"
      columns: ["import_id"]
isOneToOne: false
      referencedRelation: "imports"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "add_household_member":
{ Args: { "p_display_name": string,"p_email": string }; Returns: string
                           },
"create_household":
{ Args: { "p_display_name": string,"p_name": string }; Returns: string
                           },
"import_batch":
{ Args: { "p_account_id": string,"p_balance_cents"?: number,"p_exported_on": string,"p_file_sha256": string,"p_format": string,"p_original_filename": string,"p_rows": Json,"p_skip"?: (number)[],"p_storage_path": string }; Returns: Json
                           },
"preview_import":
{ Args: { "p_account_id": string,"p_rows": Json }; Returns: {
              "ordinal": number,"outcome": string,"suspect": Json
            }[]
                           }
          }
          Enums: {
            "account_type": "checking"|"savings"|"credit_card"|"mortgage"|"auto_loan"|"other_loan"|"other","member_role": "owner"|"member","txn_status": "posted"|"pending"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "account_type": ["checking", "savings", "credit_card", "mortgage", "auto_loan", "other_loan", "other"],"member_role": ["owner", "member"],"txn_status": ["posted", "pending"]
          }
        }
} as const
